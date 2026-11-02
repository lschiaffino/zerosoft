/** Lo común de las pantallas de permisos (código y dispositivo). */
import type { UserRow } from '../db';
import { listMyWorkspaces } from '../workspace';
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

/** Workspace elegido: el id para fijar (null = el propio), o undefined si no es de la persona. */
export async function resolveConsentWorkspace(real: UserRow, teamId: string | null | undefined): Promise<string | null | undefined> {
  const chosen = teamId === undefined ? (real.active_team_id ?? null) : teamId;
  const rows = await listMyWorkspaces(real);
  return rows.some((w) => w.teamId === chosen) ? chosen : undefined;
}
