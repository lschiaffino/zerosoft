import type { Client, InValue } from '@libsql/client';
import { mirrorGroups } from '../workspace-groups-mirror';

/**
 * Migración 128_workspace_teams: el workspace como equipo de todas las apps
 * (ver lib/workspace.ts). Es ADITIVA: solo agrega columnas, tablas y filas.
 *
 * - No borra equipos, no junta equipos ni datos de distintos owners, no
 *   reescribe ids (proyectos, claves de issues, labels, webhooks de Track,
 *   widgets de Chat) y no toca las tablas de subequipos de cada app.
 * - Un owner con varios equipos los conserva: el más viejo pasa a ser la
 *   ficha del workspace y los demás siguen funcionando como hoy.
 * - Los equipos que ya existían quedan `keyed_by = 'team'`: sus datos de
 *   Track y Chat siguen colgando del id del equipo, como hasta ahora. Las
 *   fichas nuevas son `keyed_by = 'owner'`: todo cuelga del id del owner.
 * - Para volver atrás alcanza con ignorar las columnas y tablas nuevas: el
 *   código viejo no las lee.
 *
 * Idempotente: si se corta a la mitad y vuelve a correr (o corren dos
 * instancias a la vez) el resultado es el mismo.
 */

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

async function run(client: Client, sql: string, args: InValue[] = []): Promise<void> {
  await client.execute({ sql, args });
}

async function hasColumn(client: Client, table: string, column: string): Promise<boolean> {
  const rows = (await client.execute(`PRAGMA table_info(${table})`)).rows;
  return rows.some((r) => r.name === column);
}

async function tableExists(client: Client, name: string): Promise<boolean> {
  const rows = (await client.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [name] }))
    .rows;
  return rows.length > 0;
}

export function slugifyName(name: string, fallback = 'team'): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || fallback
  );
}

export async function workspaceTeamsUp(client: Client): Promise<void> {
  // ---------- Ficha del workspace ----------
  const hadKeyedBy = await hasColumn(client, 'teams', 'keyed_by');
  await addColumn(client, "ALTER TABLE teams ADD COLUMN keyed_by TEXT NOT NULL DEFAULT 'owner'");
  await addColumn(client, 'ALTER TABLE teams ADD COLUMN slug TEXT');
  await addColumn(client, 'ALTER TABLE teams ADD COLUMN logo_url TEXT');
  await addColumn(client, 'ALTER TABLE teams ADD COLUMN use_mode TEXT');
  await addColumn(client, 'ALTER TABLE teams ADD COLUMN size TEXT');
  await addColumn(client, "ALTER TABLE teams ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
  await addColumn(client, "ALTER TABLE teams ADD COLUMN allowed_domains TEXT NOT NULL DEFAULT '[]'");
  await addColumn(client, 'ALTER TABLE teams ADD COLUMN updated_at TEXT');
  // Los equipos que ya existían siguen con sus datos de Track/Chat bajo el id
  // del equipo. Solo la primera vez: en una re-corrida no se pisan fichas nuevas.
  if (!hadKeyedBy) {
    await run(client, "UPDATE teams SET keyed_by = 'team', use_mode = COALESCE(use_mode, 'team')");
  }

  // ---------- Personas ----------
  await addColumn(client, "ALTER TABLE team_members ADD COLUMN apps TEXT NOT NULL DEFAULT '*'");
  await addColumn(client, "ALTER TABLE team_members ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  await addColumn(client, 'ALTER TABLE team_members ADD COLUMN invited_by TEXT');

  // ---------- Invitaciones ----------
  await addColumn(client, "ALTER TABLE team_invites ADD COLUMN apps TEXT NOT NULL DEFAULT '*'");
  await addColumn(client, "ALTER TABLE team_invites ADD COLUMN group_ids TEXT NOT NULL DEFAULT '[]'");
  await addColumn(client, "ALTER TABLE team_invites ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
  await addColumn(client, 'ALTER TABLE team_invites ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0');
  await addColumn(client, 'ALTER TABLE team_invites ADD COLUMN last_sent_at TEXT');
  await addColumn(client, "ALTER TABLE team_invites ADD COLUMN email_status TEXT NOT NULL DEFAULT ''");
  await addColumn(client, "ALTER TABLE team_invites ADD COLUMN email_error TEXT NOT NULL DEFAULT ''");
  await addColumn(client, 'ALTER TABLE team_invites ADD COLUMN accepted_by TEXT');
  await addColumn(client, 'ALTER TABLE team_invites ADD COLUMN accepted_at TEXT');
  await run(client, 'CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email, status)');

  // ---------- Perfil y onboarding ----------
  const hadOnboarded = await hasColumn(client, 'users', 'onboarded_at');
  await addColumn(client, 'ALTER TABLE users ADD COLUMN onboarded_at TEXT');
  await addColumn(client, "ALTER TABLE users ADD COLUMN profile TEXT NOT NULL DEFAULT '{}'");
  await addColumn(client, 'ALTER TABLE users ADD COLUMN locale TEXT');
  await addColumn(client, 'ALTER TABLE users ADD COLUMN time_zone TEXT');
  // Quien ya usaba zerosoft no ve el onboarding.
  if (!hadOnboarded) {
    await run(client, 'UPDATE users SET onboarded_at = created_at WHERE onboarded_at IS NULL');
  }

  // ---------- Una ficha por usuario ----------
  // Id determinístico (ws_<owner>): dos requests que la crean a la vez
  // terminan en la misma fila (lib/workspace.ts → ensureWorkspace).
  await run(
    client,
    `INSERT OR IGNORE INTO teams (id, name, owner_id, keyed_by, use_mode, created_at)
     SELECT 'ws_' || u.id,
            COALESCE(NULLIF(trim(u.name), ''), CASE WHEN instr(u.email, '@') > 1 THEN substr(u.email, 1, instr(u.email, '@') - 1) ELSE u.email END),
            u.id, 'owner', NULL, u.created_at
     FROM users u WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.owner_id = u.id)`,
  );
  // El owner figura como 'owner' de cada equipo suyo.
  await run(client, "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT id, owner_id, 'owner' FROM teams");
  await run(client, 'CREATE INDEX IF NOT EXISTS idx_teams_owner_created ON teams(owner_id, created_at, id)');
  await run(client, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug) WHERE slug IS NOT NULL');

  // ---------- Subequipos del workspace ----------
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS workspace_groups (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'platform',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_groups_ws ON workspace_groups(workspace_id, name);
    CREATE TABLE IF NOT EXISTS workspace_group_members (
      group_id TEXT NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_group_members_user ON workspace_group_members(user_id);
  `);

  // Los subequipos que ya existían en cada app pasan al directorio del
  // workspace con el mismo id (las reglas, pools y asignaciones que los
  // nombran siguen valiendo). Las tablas de cada app quedan como están.
  const sources: Array<{ table: string; ws: string; source: string; members: string; person: string }> = [
    { table: 'crm_sales_teams', ws: 'user_id', source: 'crm', members: 'crm_sales_team_members', person: 'person_id' },
    { table: 'chat_teams', ws: 'workspace_id', source: 'chat', members: 'chat_team_members', person: 'user_id' },
    { table: 'groups_teams', ws: 'user_id', source: 'groups', members: 'groups_team_members', person: 'person_id' },
  ];
  for (const s of sources) {
    if (!(await tableExists(client, s.table))) continue;
    await run(
      client,
      `INSERT OR IGNORE INTO workspace_groups (id, workspace_id, name, source, created_at, updated_at)
       SELECT id, ${s.ws}, name, ?, created_at, created_at FROM ${s.table}
       WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = ${s.table}.${s.ws})`,
      [s.source],
    );
    if (await tableExists(client, s.members)) {
      await run(
        client,
        `INSERT OR IGNORE INTO workspace_group_members (group_id, user_id)
         SELECT m.team_id, m.${s.person} FROM ${s.members} m
         WHERE EXISTS (SELECT 1 FROM workspace_groups g WHERE g.id = m.team_id)
           AND EXISTS (SELECT 1 FROM users u WHERE u.id = m.${s.person})`,
      );
    }
  }
  // Slugs únicos por workspace (para @menciones en Talk).
  const groups = (await client.execute("SELECT id, workspace_id, name FROM workspace_groups WHERE slug = '' ORDER BY workspace_id, created_at, id"))
    .rows;
  const taken = new Map<string, Set<string>>();
  for (const r of (await client.execute("SELECT workspace_id, slug FROM workspace_groups WHERE slug != ''")).rows) {
    const ws = String(r.workspace_id);
    if (!taken.has(ws)) taken.set(ws, new Set());
    taken.get(ws)!.add(String(r.slug));
  }
  for (const g of groups) {
    const ws = String(g.workspace_id);
    const set = taken.get(ws) ?? new Set<string>();
    taken.set(ws, set);
    const base = slugifyName(String(g.name));
    let slug = base;
    for (let n = 2; set.has(slug); n++) slug = `${base}-${n}`;
    set.add(slug);
    await run(client, "UPDATE workspace_groups SET slug = ? WHERE id = ? AND slug = ''", [slug, String(g.id)]);
  }

  // Cada subequipo queda disponible en todas las apps que usan equipos (sin podar nada).
  await mirrorGroups((sql, args = []) => client.execute({ sql, args }), { prune: false });
}
