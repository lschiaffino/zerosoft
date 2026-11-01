/**
 * Pedidos de acceso a una app (tabla workspace_access_requests) y los avisos
 * alrededor: quién los recibe, qué pasa al responderlos y qué se le dice a la
 * persona. Nada sale por email: el texto lo arma zerosoft.
 *
 * - Llegan solo a quien puede resolverlos: el owner y los admins que tienen la
 *   app (un admin no da apps que no tiene). Lo que pide un admin va al owner:
 *   otro admin no puede tocarlo.
 * - Un pedido queda pendiente hasta que se responde (dar la app, rechazarlo o
 *   que la persona deje el workspace). Repetirlo dentro de las 24 horas no
 *   vuelve a avisar; una vez respondido se puede pedir de nuevo.
 * - Al resolverse, los avisos sin leer de los demás admins se dan por leídos.
 * - El link lleva el workspace (&ws=): quien administra varios puede tener otro
 *   activo, y la página solo abre el acceso en el workspace del pedido.
 */
import { getDb, type TeamRow } from './db';
import { localized, renderForRecipient, type NotificationCopyKey } from './notification-copy';
import { createNotification } from './notifications';
import { PRODUCT_CONFIG, isProductKey, type ProductKey } from './products';
import { canUseApp, parseApps, type AppAccess } from './workspace';

const REPEAT_AFTER_MS = 86_400_000;
type TeamRef = Pick<TeamRow, 'id' | 'owner_id' | 'name'>;

export function accessRequestHref(teamId: string, personId: string): string {
  return `/app/settings/members?person=${encodeURIComponent(personId)}&ws=${encodeURIComponent(teamId)}`;
}

function appNames(apps: readonly string[]): string {
  return apps.map((a) => (isProductKey(a) ? PRODUCT_CONFIG[a].name : a)).join(', ');
}

/** Owner y admins (ids reales) con su acceso. */
async function managers(team: Pick<TeamRow, 'id' | 'owner_id'>): Promise<Array<{ id: string; role: string; apps: AppAccess }>> {
  const rows = (await getDb()
    .prepare("SELECT user_id, role, apps FROM team_members WHERE team_id = ? AND role IN ('owner', 'admin')")
    .all(team.id)) as Array<{ user_id: string; role: string; apps: string }>;
  const others = rows.filter((r) => r.user_id !== team.owner_id).map((r) => ({ id: r.user_id, role: r.role, apps: parseApps(r.apps) }));
  return [{ id: team.owner_id, role: 'owner', apps: '*' as AppAccess }, ...others];
}

/** Owner y admins del workspace (ids reales), sin repetir. */
export async function workspaceAdminIds(team: Pick<TeamRow, 'id' | 'owner_id'>): Promise<string[]> {
  return (await managers(team)).map((m) => m.id);
}

/** Quién puede resolver un pedido de esta persona por esta app. */
async function requestRecipients(team: Pick<TeamRow, 'id' | 'owner_id'>, whoId: string, whoRole: string, app: ProductKey): Promise<string[]> {
  const all = (await managers(team)).filter((m) => m.id !== whoId);
  if (whoRole === 'admin') return all.filter((m) => m.role === 'owner').map((m) => m.id);
  return all.filter((m) => canUseApp({ role: m.role, apps: m.apps }, app)).map((m) => m.id);
}

/** Pendientes de un workspace: persona → apps. */
export async function pendingRequests(teamId: string): Promise<Map<string, ProductKey[]>> {
  const rows = (await getDb()
    .prepare("SELECT person_id, app FROM workspace_access_requests WHERE team_id = ? AND status = 'pending' ORDER BY requested_at, app")
    .all(teamId)) as Array<{ person_id: string; app: string }>;
  const out = new Map<string, ProductKey[]>();
  for (const r of rows) if (isProductKey(r.app)) out.set(r.person_id, [...(out.get(r.person_id) ?? []), r.app]);
  return out;
}

export async function isRequestPending(teamId: string, personId: string, app: ProductKey): Promise<boolean> {
  return Boolean(
    await getDb()
      .prepare("SELECT 1 AS x FROM workspace_access_requests WHERE team_id = ? AND person_id = ? AND app = ? AND status = 'pending'")
      .get(teamId, personId, app),
  );
}

/**
 * Registra el pedido y avisa. `already`: ya estaba pendiente hace menos de 24
 * horas (compare-and-set: dos pedidos a la vez avisan una sola vez).
 */
export async function askForApp(team: TeamRef, who: { id: string; name: string | null; email: string; role: string }, app: ProductKey): Promise<{ already: boolean }> {
  const db = getDb();
  const now = new Date();
  const res = await db
    .prepare(
      `INSERT INTO workspace_access_requests (team_id, person_id, app, status, requested_at) VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT (team_id, person_id, app) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at, resolved_at = NULL, resolved_by = NULL
       WHERE workspace_access_requests.status != 'pending' OR workspace_access_requests.requested_at <= ?`,
    )
    .run(team.id, who.id, app, now.toISOString(), new Date(now.getTime() - REPEAT_AFTER_MS).toISOString());
  if (res.changes === 0) return { already: true };
  const person = who.name?.trim() || who.email;
  for (const userId of await requestRecipients(team, who.id, who.role, app)) {
    const open = (await db
      .prepare(
        `SELECT id, meta FROM notifications
         WHERE user_id = ? AND type = 'workspace_access' AND source_type = 'workspace' AND source_id = ? AND read_at IS NULL
           AND json_extract(meta, '$.requestedBy') = ? AND json_extract(meta, '$.apps') IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId, team.id, who.id)) as { id: string; meta: string } | undefined;
    if (open) {
      // Un aviso por persona, no uno por app, mientras siga sin leer.
      const prev = (JSON.parse(open.meta) as { apps?: string[] }).apps ?? [];
      const apps = [...new Set([...prev, app])];
      const [title] = await renderForRecipient(userId, [localized('appAccessRequest', { who: person, app: appNames(apps) })]);
      await db
        .prepare('UPDATE notifications SET title = ?, meta = ?, created_at = ? WHERE id = ?')
        .run(title ?? '', JSON.stringify({ apps, requestedBy: who.id }), now.toISOString(), open.id);
      continue;
    }
    await createNotification({
      userId,
      type: 'workspace_access',
      title: localized('appAccessRequest', { who: person, app: PRODUCT_CONFIG[app].name }),
      body: localized('appAccessRequestBody', { workspace: team.name }),
      href: accessRequestHref(team.id, who.id),
      sourceType: 'workspace',
      sourceId: team.id,
      meta: { apps: [app], requestedBy: who.id },
    });
  }
  return { already: false };
}

/**
 * Cierra pendientes ('*' = todos) y devuelve cuáles. Sin pendientes restantes,
 * los avisos sin leer de ese pedido dejan de esperar a nadie.
 */
export async function resolveRequests(
  teamId: string,
  personId: string,
  apps: '*' | readonly string[],
  status: 'granted' | 'denied' | 'closed',
  resolvedBy: string | null,
): Promise<string[]> {
  const db = getDb();
  const pending = (await pendingRequests(teamId)).get(personId) ?? [];
  const target = apps === '*' ? pending : pending.filter((a) => apps.includes(a));
  const now = new Date().toISOString();
  const closed: string[] = [];
  for (const app of target) {
    const res = await db
      .prepare("UPDATE workspace_access_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE team_id = ? AND person_id = ? AND app = ? AND status = 'pending'")
      .run(status, now, resolvedBy, teamId, personId, app);
    if (res.changes > 0) closed.push(app);
  }
  if (closed.length) await refreshRequestNotices(teamId, personId, pending.filter((a) => !closed.includes(a)), now);
  return closed;
}

/**
 * Los avisos sin leer dicen solo lo que sigue pendiente: si ya no queda nada de
 * lo que le tocaba a esa persona, se dan por leídos.
 */
async function refreshRequestNotices(teamId: string, personId: string, remaining: string[], now: string): Promise<void> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT id, user_id, meta FROM notifications WHERE type = 'workspace_access' AND source_type = 'workspace' AND source_id = ? AND read_at IS NULL
       AND json_extract(meta, '$.requestedBy') = ? AND json_extract(meta, '$.apps') IS NOT NULL`,
    )
    .all(teamId, personId)) as Array<{ id: string; user_id: string; meta: string }>;
  if (!rows.length) return;
  const who = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(personId)) as { name: string | null; email: string } | undefined;
  for (const row of rows) {
    const apps = ((JSON.parse(row.meta) as { apps?: string[] }).apps ?? []).filter((a) => remaining.includes(a));
    if (!apps.length) {
      await db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(now, row.id);
      continue;
    }
    const [title] = await renderForRecipient(row.user_id, [localized('appAccessRequest', { who: who?.name?.trim() || who?.email || '', app: appNames(apps) })]);
    await db.prepare('UPDATE notifications SET title = ?, meta = ? WHERE id = ?').run(title ?? '', JSON.stringify({ apps, requestedBy: personId }), row.id);
  }
}

/** Aviso a owner y admins de que alguien de su dominio pidió sumarse. */
export async function notifyJoinRequest(team: Pick<TeamRow, 'id' | 'owner_id' | 'name'>, who: { id: string; email: string }): Promise<void> {
  for (const userId of await workspaceAdminIds(team)) {
    if (userId === who.id) continue;
    await createNotification({
      userId,
      type: 'workspace_access',
      title: localized('joinRequest', { who: who.email, workspace: team.name }),
      href: '/app/settings/members',
      sourceType: 'workspace_join',
      sourceId: team.id,
      meta: { requestedBy: who.id },
    });
  }
}

/** Apps que `after` da y `before` no ('*' = todas). */
export function grantedApps(before: AppAccess, after: AppAccess): '*' | string[] {
  if (before === '*') return [];
  if (after === '*') return '*';
  return after.filter((a) => !before.includes(a));
}

/** Avisos a la persona que cambió. El link va al inicio: puede tener otro workspace activo. */
async function notifyPerson(
  team: Pick<TeamRow, 'id'>,
  personId: string,
  key: NotificationCopyKey,
  vars: Record<string, string>,
  sourceType: string,
  body?: { key: NotificationCopyKey; vars: Record<string, string> },
): Promise<void> {
  await createNotification({
    userId: personId,
    type: 'workspace_access',
    title: localized(key, vars),
    body: body ? localized(body.key, body.vars) : undefined,
    href: '/app',
    sourceType,
    sourceId: team.id,
  });
}

const actorName = (actor: { name: string | null; email: string }) => actor.name?.trim() || actor.email;

/** Le dieron apps nuevas. */
export async function notifyAppsGranted(team: Pick<TeamRow, 'id' | 'name'>, personId: string, actor: { name: string | null; email: string }, granted: '*' | string[]): Promise<void> {
  if (granted !== '*' && !granted.length) return;
  const who = actorName(actor);
  if (granted === '*') return notifyPerson(team, personId, 'appAccessGrantedAll', { who, workspace: team.name }, 'workspace_grant');
  return notifyPerson(team, personId, 'appAccessGranted', { who, app: appNames(granted), workspace: team.name }, 'workspace_grant');
}

/** Rechazaron su pedido: lo sabe y puede volver a pedirlo. */
export async function notifyAppsDenied(team: Pick<TeamRow, 'id' | 'name'>, personId: string, actor: { name: string | null; email: string }, apps: string[]): Promise<void> {
  if (!apps.length) return;
  return notifyPerson(team, personId, 'appAccessDenied', { who: actorName(actor), app: appNames(apps), workspace: team.name }, 'workspace_deny', { key: 'appAccessDeniedBody', vars: {} });
}

/** Avisos que la persona también ve una vez al entrar a su inicio (lib/home: lostAccessNotice). */
export const LOST_ACCESS_SOURCE = 'workspace_lost';

/** La sacaron del workspace: qué pasó y a quién preguntarle. */
export async function notifyRemoved(team: Pick<TeamRow, 'id' | 'name'>, personId: string, actor: { name: string | null; email: string }): Promise<void> {
  const who = actorName(actor);
  return notifyPerson(team, personId, 'workspaceRemoved', { who, workspace: team.name }, LOST_ACCESS_SOURCE, { key: 'workspaceChangeAsk', vars: { who } });
}

const ROLE_KEYS: Record<string, NotificationCopyKey> = { admin: 'roleNameAdmin', member: 'roleNameMember', guest: 'roleNameGuest' };

/** Le cambiaron el rol. Pasar a guest saca del workspace: también se le dice al entrar. */
export async function notifyRoleChanged(team: Pick<TeamRow, 'id' | 'name'>, personId: string, actor: { name: string | null; email: string }, role: 'admin' | 'member' | 'guest'): Promise<void> {
  const who = actorName(actor);
  const [roleName] = await renderForRecipient(personId, [localized(ROLE_KEYS[role])]);
  const key: NotificationCopyKey = role === 'guest' ? 'workspaceDemotedGuest' : 'workspaceRoleChanged';
  return notifyPerson(team, personId, key, { who, workspace: team.name, role: roleName ?? role }, role === 'guest' ? LOST_ACCESS_SOURCE : 'workspace_role', {
    key: 'workspaceChangeAsk',
    vars: { who },
  });
}

/** El aviso más nuevo de "perdiste el acceso" sin leer: el inicio lo muestra una vez. */
export async function lostAccessNotice(personId: string): Promise<{ id: string; title: string; body: string | null } | null> {
  const row = (await getDb()
    .prepare("SELECT id, title, body FROM notifications WHERE user_id = ? AND type = 'workspace_access' AND source_type = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get(personId, LOST_ACCESS_SOURCE)) as { id: string; title: string; body: string | null } | undefined;
  return row ?? null;
}
