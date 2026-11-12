/**
 * Inbox y Lines: revalidar una conexión del aviso en vivo que lleva un rato
 * abierta (lib/wa-live.ts). Lo que hace falta se toma al conectar (la persona,
 * su sesión y el workspace activo) y acá se vuelve a mirar en la base, con los
 * mismos chequeos que hace la sesión en cada pedido (lib/session.ts): la
 * sesión sigue valiendo, el workspace activo es el mismo (si cambió en otra
 * pestaña, el pedido de esta pestaña ya no valdría), el workspace no empezó a
 * pedir dos pasos que la persona no tiene, y la app sigue abierta para ella
 * (Próximamente, Apps del workspace, sus apps). No usa cookies() ni headers():
 * corre un minuto después de haber empezado a responder, fuera de lo que Next
 * garantiza para esas funciones. Server-only.
 */
import { getDb, getUserById } from './db';
import { getSessionRow, mfaEnabled, sessionState } from './account-security';
import { groupsViewer, type GroupsViewer } from './groups-access';
import { resolveWorkspace, roleAtLeast, type TeamRole } from './teams';
import { userCanUseApp } from './workspace';
import { blockedAppsFor } from './workspace-apps';
import type { ProductKey } from './products';

/** Lo que se guarda de la sesión al conectar. `sid` null: sesión sin fila (modo demo, o de antes de las sesiones por dispositivo). */
export interface LiveSession {
  userId: string;
  sid: string | null;
}

/** ¿La sesión sigue valiendo? La persona existe y su sesión no se cerró, no venció ni le falta el segundo paso. */
export async function liveSessionValid(s: LiveSession): Promise<boolean> {
  const [user, row] = await Promise.all([getUserById(s.userId), s.sid ? getSessionRow(s.sid) : Promise.resolve(null)]);
  return !!user && sessionState(user, s.sid, row) === 'ok';
}

/**
 * La conexión sigue valiendo como al conectar: la sesión, el mismo workspace
 * activo (`workspaceId`, el que tenía la pestaña), sin dos pasos pendientes y
 * con la app abierta. Devuelve el workspace (su dueño) y el rol de hoy, o null.
 */
export async function liveAccessNow(s: LiveSession & { workspaceId: string | null }, app: ProductKey): Promise<{ ws: string; role: TeamRole } | null> {
  const [user, row] = await Promise.all([getUserById(s.userId), s.sid ? getSessionRow(s.sid) : Promise.resolve(null)]);
  if (!user || sessionState(user, s.sid, row) !== 'ok') return null;
  const { owner, workspace, role, apps } = await resolveWorkspace(user);
  // Cambió de workspace (en otra pestaña): la pestaña quedó en el anterior, y su pedido ya no valdría.
  if (s.workspaceId && workspace?.id !== s.workspaceId) return null;
  // El workspace ajeno empezó a pedir dos pasos y la persona no los tiene: no entra a sus datos.
  if (owner.id !== user.id && workspace?.require_mfa && !mfaEnabled(user)) return null;
  const blockedApps = await blockedAppsFor({ ownerId: owner.id, personId: user.id, role, email: user.email });
  if (!userCanUseApp({ role, apps, blockedApps }, app)) return null;
  return { ws: owner.id, role };
}

/**
 * Quién mira Lines hoy: null si ya no es del workspace. El rol es el menor
 * entre el que tenía al conectar y el de ahora: una conexión abierta nunca ve
 * más de lo que su sesión veía, y ve menos apenas le bajan el rol.
 */
export async function linesViewerNow(ws: string, me: string, connectedAs: TeamRole, now?: TeamRole): Promise<GroupsViewer | null> {
  let current = now;
  if (!current) {
    if (me !== ws) {
      // Miembro o invitado de algún equipo del workspace (los invitados también usan Lines, con acceso restringido).
      const member = (await getDb()
        .prepare('SELECT m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = ? LIMIT 1')
        .get(ws, me)) as { role: TeamRole } | undefined;
      if (!member) return null;
      const { workspaceRole } = await import('./api-auth');
      current = await workspaceRole(ws, me);
    } else current = 'owner';
  }
  return groupsViewer(ws, me, roleAtLeast(current, connectedAs) ? connectedAs : current);
}
