/**
 * Ajustes › Apps del workspace, en la base: una fila de workspace_apps por app
 * con regla (sin fila = para todos). La clave es el owner, como los datos y los
 * equipos del workspace. La regla en sí vive en lib/app-access.ts.
 */
import { getDb, type Db } from './db';
import { blockedApps, isRuleKey, parseRule, type WorkspaceAppRule, type WorkspaceAppRules } from './app-access';
import { isAdminEmail } from './feedback';
import { isComingSoon, type ProductKey } from './products';

function parseIds(raw: unknown): string[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Reglas del workspace del owner. Sin la tabla (base vieja en un test) no hay reglas. */
export async function loadWorkspaceAppRules(ownerId: string, db: Db = getDb()): Promise<WorkspaceAppRules> {
  let rows: Array<{ app: string; mode: string; people: string; teams: string }>;
  try {
    rows = (await db.prepare('SELECT app, mode, people, teams FROM workspace_apps WHERE owner_id = ?').all(ownerId)) as typeof rows;
  } catch {
    return {};
  }
  const out: WorkspaceAppRules = {};
  for (const r of rows) {
    if (!isRuleKey(r.app)) continue;
    const rule = parseRule({ mode: r.mode, people: parseIds(r.people), teams: parseIds(r.teams) });
    if (rule) out[r.app] = rule;
  }
  return out;
}

/** Guarda la regla de una app ('all' borra la fila: es lo de siempre). Devuelve la anterior. */
export async function saveWorkspaceAppRule(
  ownerId: string,
  app: ProductKey,
  rule: WorkspaceAppRule,
  actorId: string,
  db: Db = getDb(),
): Promise<WorkspaceAppRule> {
  const before = (await loadWorkspaceAppRules(ownerId, db))[app] ?? { mode: 'all', people: [], teams: [] };
  if (rule.mode === 'all') {
    await db.prepare('DELETE FROM workspace_apps WHERE owner_id = ? AND app = ?').run(ownerId, app);
  } else {
    await db
      .prepare(
        `INSERT INTO workspace_apps (owner_id, app, mode, people, teams, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(owner_id, app) DO UPDATE SET mode = excluded.mode, people = excluded.people, teams = excluded.teams,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(ownerId, app, rule.mode, JSON.stringify(rule.people), JSON.stringify(rule.teams), actorId);
  }
  return before;
}

/** Equipos del workspace de una persona (sin la tabla, ninguno). */
async function personTeamIds(ownerId: string, personId: string, db: Db): Promise<string[]> {
  try {
    const rows = (await db
      .prepare(
        `SELECT m.group_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id
         WHERE g.workspace_id = ? AND m.user_id = ?`,
      )
      .all(ownerId, personId)) as Array<{ group_id: string }>;
    return rows.map((r) => r.group_id);
  } catch {
    return [];
  }
}

/** ¿Es staff de zerosoft? (ADMIN_EMAILS: abre las apps "Próximamente" para probarlas.) */
export function isStaff(email: string | null | undefined): boolean {
  return isAdminEmail(email);
}

/**
 * Apps que la persona no abre en el workspace del owner por la plataforma
 * (Próximamente) o por Apps del workspace. Sus toggles de Miembros van aparte
 * (canUseApp). Una sola lectura de la base; dos si hay una regla "algunos".
 */
export async function blockedAppsFor(
  subject: { ownerId: string; personId: string; role: string | null | undefined; email: string | null | undefined },
  db: Db = getDb(),
): Promise<ProductKey[]> {
  const rules = await loadWorkspaceAppRules(subject.ownerId, db);
  const needsTeams = Object.values(rules).some((r) => r?.mode === 'some') && subject.role !== 'owner' && subject.role !== 'admin';
  const teamIds = needsTeams ? await personTeamIds(subject.ownerId, subject.personId, db) : [];
  return blockedApps({ role: subject.role, personId: subject.personId, teamIds, staff: isStaff(subject.email) }, rules);
}

/** Solo plataforma (sin base): para quien no tiene workspace resuelto todavía. */
export function comingSoonBlocked(email: string | null | undefined): ProductKey[] {
  return isStaff(email) ? [] : blockedApps({ role: 'owner', personId: '', staff: false }).filter((a) => isComingSoon(a));
}
