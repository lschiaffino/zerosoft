/**
 * Pedidos que llegan a quien administra el workspace: "quiero usar {app}"
 * (desde la pantalla de app bloqueada) y "quiero sumarme" (dominio con
 * aprobación). Cada pedido es un aviso en la bandeja del owner y de cada
 * admin, con link a Ajustes › Miembros. Nada sale por email: el texto lo
 * arma zerosoft con el nombre de la app y de la persona.
 *
 * El link lleva el workspace (&ws=): quien administra varios puede tener otro
 * activo, y la página solo abre el acceso de la persona en el workspace del pedido.
 */
import { getDb, type TeamRow } from './db';
import { localized, renderForRecipient } from './notification-copy';
import { createNotification } from './notifications';
import { PRODUCT_CONFIG, isProductKey, type ProductKey } from './products';
import type { AppAccess } from './workspace';

/** Owner y admins del workspace (ids reales), sin repetir. */
export async function workspaceAdminIds(team: Pick<TeamRow, 'id' | 'owner_id'>): Promise<string[]> {
  const rows = (await getDb()
    .prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role IN ('owner', 'admin')")
    .all(team.id)) as Array<{ user_id: string }>;
  return [...new Set([team.owner_id, ...rows.map((r) => r.user_id)])];
}

export function accessRequestHref(teamId: string, personId: string): string {
  return `/app/settings/members?person=${encodeURIComponent(personId)}&ws=${encodeURIComponent(teamId)}`;
}

function appNames(apps: readonly string[]): string {
  return apps.map((a) => (isProductKey(a) ? PRODUCT_CONFIG[a].name : a)).join(', ');
}

/**
 * Aviso a owner y admins de que `who` pide usar `app`. Si esa persona ya tiene
 * un pedido sin leer en la bandeja de quien recibe, se suma a ese aviso (una
 * línea por persona, no una por app). Devuelve a cuántos les llegó.
 */
export async function notifyAppAccessRequest(
  team: Pick<TeamRow, 'id' | 'owner_id' | 'name'>,
  who: { id: string; name: string | null; email: string },
  app: ProductKey,
): Promise<number> {
  const db = getDb();
  const admins = (await workspaceAdminIds(team)).filter((id) => id !== who.id);
  const person = who.name?.trim() || who.email;
  for (const userId of admins) {
    const open = (await db
      .prepare(
        `SELECT id, meta FROM notifications
         WHERE user_id = ? AND type = 'workspace_access' AND source_type = 'workspace' AND source_id = ? AND read_at IS NULL
           AND json_extract(meta, '$.requestedBy') = ? AND json_extract(meta, '$.apps') IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId, team.id, who.id)) as { id: string; meta: string } | undefined;
    if (open) {
      const prev = (JSON.parse(open.meta) as { apps?: string[] }).apps ?? [];
      const apps = [...new Set([...prev, app])];
      const [title] = await renderForRecipient(userId, [localized('appAccessRequest', { who: person, app: appNames(apps) })]);
      await db
        .prepare('UPDATE notifications SET title = ?, meta = ?, created_at = ? WHERE id = ?')
        .run(title ?? '', JSON.stringify({ apps, requestedBy: who.id }), new Date().toISOString(), open.id);
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
  return admins.length;
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
      sourceType: 'workspace',
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

/**
 * Le avisa a la persona que ya puede usar apps nuevas. El link va al inicio y
 * no a la app: puede tener otro workspace activo. El texto dice cuál es.
 */
export async function notifyAppsGranted(
  team: Pick<TeamRow, 'id' | 'name'>,
  personId: string,
  actor: { name: string | null; email: string },
  granted: '*' | string[],
): Promise<void> {
  if (granted !== '*' && !granted.length) return;
  const who = actor.name?.trim() || actor.email;
  await createNotification({
    userId: personId,
    type: 'workspace_access',
    title:
      granted === '*'
        ? localized('appAccessGrantedAll', { who, workspace: team.name })
        : localized('appAccessGranted', { who, app: appNames(granted), workspace: team.name }),
    href: '/app',
    sourceType: 'workspace_grant',
    sourceId: team.id,
  });
}
