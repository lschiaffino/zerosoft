/** Lo común de las pantallas de permisos (código y dispositivo). */
import type { UserRow } from '../db';
import { ensureWorkspace, listMyWorkspaces, teamKeyed } from '../workspace';
import { issuerUrl } from './store';

/**
 * La decisión viene de una página de este sitio. La cookie de sesión es
 * SameSite=Lax, pero aprobar da acceso a toda la cuenta: se exige Origin propio
 * y, si el navegador lo manda, Sec-Fetch-Site same-origin. Sin Origin no pasa.
 */
export function sameSiteRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(issuerUrl()).origin) return false;
  const site = req.headers.get('sec-fetch-site');
  return !site || site === 'same-origin';
}

/**
 * El workspace propio figura en la lista como null, pero active_team_id puede
 * tener su id (volver al propio por un link de invitación, el switcher viejo).
 * Ese id es el propio: se normaliza a null. Sin esto la pantalla de permisos
 * mandaba un id que no estaba en la lista y aprobar fallaba con 403 para
 * siempre (el cliente se quedaba en "Needs authentication").
 */
export async function consentTeamId(real: Pick<UserRow, 'id'>, teamId: string | null | undefined): Promise<string | null> {
  if (!teamId) return null;
  const own = await ensureWorkspace(real.id);
  return teamId === own.id && !teamKeyed(own) ? null : teamId;
}

/** Workspace elegido: el id para fijar (null = el propio), o undefined si no es de la persona. */
export async function resolveConsentWorkspace(real: UserRow, teamId: string | null | undefined): Promise<string | null | undefined> {
  const chosen = await consentTeamId(real, teamId === undefined ? (real.active_team_id ?? null) : teamId);
  const rows = await listMyWorkspaces(real);
  return rows.some((w) => w.teamId === chosen) ? chosen : undefined;
}
