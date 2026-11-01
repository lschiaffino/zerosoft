/**
 * Pedidos que llegan a quien administra el workspace: "quiero usar {app}"
 * (desde la pantalla de app bloqueada) y "quiero sumarme" (dominio con
 * aprobación). Cada pedido es un aviso en la bandeja del owner y de cada
 * admin, con link a Ajustes › Miembros. Nada sale por email: el texto lo
 * arma zerosoft con el nombre de la app y de la persona.
 */
import { getDb, type TeamRow } from './db';
import { localized } from './notification-copy';
import { createNotification } from './notifications';
import { PRODUCT_CONFIG, type ProductKey } from './products';

/** Owner y admins del workspace (ids reales), sin repetir. */
export async function workspaceAdminIds(team: Pick<TeamRow, 'id' | 'owner_id'>): Promise<string[]> {
  const rows = (await getDb()
    .prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role IN ('owner', 'admin')")
    .all(team.id)) as Array<{ user_id: string }>;
  return [...new Set([team.owner_id, ...rows.map((r) => r.user_id)])];
}

/** Aviso a owner y admins de que `who` pide usar `app`. Devuelve a cuántos les llegó. */
export async function notifyAppAccessRequest(
  team: Pick<TeamRow, 'id' | 'owner_id' | 'name'>,
  who: { id: string; name: string | null; email: string },
  app: ProductKey,
): Promise<number> {
  const admins = (await workspaceAdminIds(team)).filter((id) => id !== who.id);
  const person = who.name?.trim() || who.email;
  for (const userId of admins) {
    await createNotification({
      userId,
      type: 'workspace_access',
      title: localized('appAccessRequest', { who: person, app: PRODUCT_CONFIG[app].name }),
      body: localized('appAccessRequestBody', { workspace: team.name }),
      href: `/app/settings/members?person=${encodeURIComponent(who.id)}`,
      sourceType: 'workspace',
      sourceId: team.id,
      meta: { app, requestedBy: who.id },
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
