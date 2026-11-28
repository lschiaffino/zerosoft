/**
 * Track — acceso a lo que se abre en el panel de la bandeja (server only: lo
 * usan las rutas inbox/project/[id] e inbox/initiative/[id]). Aparte de
 * lib/track-inbox-panel, que también importan componentes del cliente.
 */
import { getAccessiblePlan } from './track-plans';
import { getAccessibleInitiative } from './track-initiatives';

/**
 * El project o la iniciativa de un aviso, si la persona los puede abrir hoy
 * (mismo alcance que sus páginas: workspace, y la planificación cerrada a los
 * invitados).
 */
export async function inboxEntityFor(
  kind: 'project' | 'initiative',
  id: string,
  user: { id: string; team?: { id: string } | null },
): Promise<{ id: string } | undefined> {
  const scope = { teamId: user.team?.id ?? null, ownerId: user.id };
  return kind === 'project' ? getAccessiblePlan(id, scope) : getAccessibleInitiative(id, scope);
}
