/**
 * Ajustes › Apps del workspace, en la base: una fila de workspace_apps por app
 * con regla (sin fila = para todos). La clave es el owner, como los datos y los
 * equipos del workspace. La regla en sí vive en lib/app-access.ts.
 */
import { getDb, type Db } from './db';
import { blockedApps, EMPTY_RULE, isDefaultRule, isRuleKey, parseRule, type WorkspaceAppRule, type WorkspaceAppRules } from './app-access';
import { isAdminEmail } from './feedback';
import { isE2eTestEnv } from './e2e-env';
import { isComingSoon, type ProductKey } from './products';
import { cleanFeaturedApps } from './featured-apps';
import type { TeamRole } from './teams';

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
  let rows: Array<{ app: string; mode: string; people: string; teams: string; denied?: string }>;
  try {
    rows = (await db.prepare('SELECT app, mode, people, teams, denied FROM workspace_apps WHERE owner_id = ?').all(ownerId)) as typeof rows;
  } catch (err) {
    // Solo una base sin la tabla (tests viejos) cuenta como "sin reglas"; cualquier otro error no abre nada.
    if (/no such table/i.test(String(err))) return {};
    throw err;
  }
  const out: WorkspaceAppRules = {};
  for (const r of rows) {
    if (!isRuleKey(r.app)) continue;
    const rule = parseRule({ mode: r.mode, people: parseIds(r.people), teams: parseIds(r.teams), denied: parseIds(r.denied) });
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
  const before = (await loadWorkspaceAppRules(ownerId, db))[app] ?? EMPTY_RULE;
  if (isDefaultRule(rule)) {
    await db.prepare('DELETE FROM workspace_apps WHERE owner_id = ? AND app = ?').run(ownerId, app);
  } else {
    await db
      .prepare(
        `INSERT INTO workspace_apps (owner_id, app, mode, people, teams, denied, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(owner_id, app) DO UPDATE SET mode = excluded.mode, people = excluded.people, teams = excluded.teams, denied = excluded.denied,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(ownerId, app, rule.mode, JSON.stringify(rule.people), JSON.stringify(rule.teams), JSON.stringify(rule.denied), actorId);
  }
  return before;
}

/** Apps destacadas del workspace del owner, en el orden del menú. Sin la tabla (base vieja en un test), ninguna. */
export async function loadWorkspaceFeaturedApps(ownerId: string, db: Db = getDb()): Promise<ProductKey[]> {
  try {
    const rows = (await db.prepare('SELECT app FROM workspace_featured_apps WHERE owner_id = ?').all(ownerId)) as Array<{ app: string }>;
    return cleanFeaturedApps(rows.map((r) => r.app));
  } catch (err) {
    if (/no such table/i.test(String(err))) return [];
    throw err;
  }
}

/** Destaca una app o le saca la marca (una fila por app: dos admins a la vez no se pisan). Devuelve la lista nueva. */
export async function setWorkspaceFeaturedApp(ownerId: string, app: ProductKey, featured: boolean, actorId: string, db: Db = getDb()): Promise<ProductKey[]> {
  if (featured) {
    await db.prepare('INSERT INTO workspace_featured_apps (owner_id, app, created_by) VALUES (?, ?, ?) ON CONFLICT(owner_id, app) DO NOTHING').run(ownerId, app, actorId);
  } else {
    await db.prepare('DELETE FROM workspace_featured_apps WHERE owner_id = ? AND app = ?').run(ownerId, app);
  }
  return loadWorkspaceFeaturedApps(ownerId, db);
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
  return isAdminEmail(email) || e2eOpensComingSoon(email);
}

/** Dominio de las personas de prueba que NO abren las apps "Próximamente" (e2e del corte). */
export const E2E_NOT_STAFF_DOMAIN = '@soon-e2e.io';

/**
 * Solo en los e2e: con E2E_COMING_SOON_OPEN=1 todas las cuentas de prueba abren
 * las apps "Próximamente" (para que las suites de esas apps sigan probándolas),
 * menos las de @soon-e2e.io, que prueban el corte. Falla cerrado, como la
 * identidad de prueba de lib/session.ts: además de la variable, solo en CI,
 * tests o el next dev de E2E_DEV=1 (lib/e2e-env.ts) y nunca en Vercel, así que
 * en producción no hace nada.
 */
function e2eOpensComingSoon(email: string | null | undefined): boolean {
  if (process.env.E2E_COMING_SOON_OPEN !== '1') return false;
  if (!isE2eTestEnv()) return false;
  return !(email ?? '').toLowerCase().endsWith(E2E_NOT_STAFF_DOMAIN);
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

/**
 * ¿La persona puede usar la app en el workspace, fuera de un pedido (avisos y
 * emails del cron)? Las tres capas, como la sesión: sigue en el workspace,
 * sus apps de Miembros y Apps del workspace (blockedAppsFor).
 */
export async function personCanUseApp(ownerId: string, personId: string, app: ProductKey, db: Db = getDb()): Promise<{ role: TeamRole } | null> {
  const { personAppAccess } = await import('./api-auth');
  const access = await personAppAccess(ownerId, personId).catch(() => null);
  if (!access) return null;
  const { canUseApp } = await import('./workspace');
  if (!canUseApp({ role: access.role, apps: access.apps as never }, app)) return null;
  const email = (await db.prepare('SELECT email FROM users WHERE id = ?').get(personId)) as { email: string | null } | undefined;
  const blocked = await blockedAppsFor({ ownerId, personId, role: access.role, email: email?.email ?? null }, db);
  return blocked.includes(app) ? null : { role: access.role };
}

/** Solo plataforma (sin base): para quien no tiene workspace resuelto todavía. */
export function comingSoonBlocked(email: string | null | undefined): ProductKey[] {
  return isStaff(email) ? [] : blockedApps({ role: 'owner', personId: '', staff: false }).filter((a) => isComingSoon(a));
}
