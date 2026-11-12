/**
 * Inbox y Lines: revalidar una conexión del aviso en vivo que lleva un rato
 * abierta (lib/wa-live.ts). Lo que hace falta se toma al conectar (la persona,
 * su sesión, el workspace y su rol) y acá se vuelve a mirar en la base. No usa
 * cookies() ni headers(): corre un minuto después de haber empezado a
 * responder, fuera de lo que Next garantiza para esas funciones. Server-only.
 */
import { getDb, getUserById } from './db';
import { getSessionRow, sessionState } from './account-security';
import { workspaceRole } from './api-auth';
import { groupsViewer, type GroupsViewer } from './groups-access';
import { roleAtLeast, type TeamRole } from './teams';

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
 * Quién mira Lines hoy: null si ya no es del workspace. El rol es el menor
 * entre el que tenía al conectar y el de ahora: una conexión abierta nunca ve
 * más de lo que su sesión veía, y ve menos apenas le bajan el rol.
 */
export async function linesViewerNow(ws: string, me: string, connectedAs: TeamRole): Promise<GroupsViewer | null> {
  if (me !== ws) {
    // Miembro o invitado de algún equipo del workspace (los invitados también usan Lines, con acceso restringido).
    const member = await getDb()
      .prepare('SELECT 1 AS ok FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = ? LIMIT 1')
      .get(ws, me);
    if (!member) return null;
  }
  const now = await workspaceRole(ws, me);
  return groupsViewer(ws, me, roleAtLeast(now, connectedAs) ? connectedAs : now);
}
