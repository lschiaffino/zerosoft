/**
 * Alcance de Track del workspace activo para los ajustes de acceso: un equipo
 * de antes de 128 (team_id) o el espacio del owner (team_id NULL), compartido
 * con su equipo. Lo usan Ajustes › Acceso y el acceso de cada team.
 */
import { getDb } from './db';
import type { getCurrentUser } from './session';
import { ensureWorkspace, listOwnerSpacePeople, ownerSpaceSql, workspaceModeOf } from './workspace';

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export interface TrackAccessScope {
  teamId: string | null;
  where: string;
  arg: string;
  /** Personal solo si el workspace está en modo personal y nadie más es parte. */
  personal: boolean;
  people: Array<{ id: string; email: string; name: string | null; role: string }>;
  isMember: (userId: string) => Promise<boolean>;
}

export async function trackAccessScope(user: SessionUser): Promise<TrackAccessScope> {
  const teamId = user.team?.id ?? null;
  const db = getDb();
  const people = teamId
    ? ((await db
        .prepare(
          `SELECT u.id, u.email, u.name, m.role FROM team_members m JOIN users u ON u.id = m.user_id
           WHERE m.team_id = ? AND m.role != 'guest' ORDER BY m.role = 'owner' DESC, u.name, u.email`,
        )
        .all(teamId)) as Array<{ id: string; email: string; name: string | null; role: string }>)
    : await listOwnerSpacePeople(user.id);
  return {
    teamId,
    where: teamId ? 'team_id = ?' : '(team_id IS NULL AND owner_id = ?)',
    arg: teamId ?? user.id,
    // Un workspace en modo equipo sin miembros todavía puede tener privados e
    // invitados: es justo lo que hace quien lo acaba de crear (antes veía
    // "creá un workspace compartido" con el workspace compartido ya creado).
    personal: !teamId && people.length <= 1 && workspaceModeOf(user.workspace ?? (await ensureWorkspace(user.id))) === 'personal',
    people,
    isMember: async (userId: string) =>
      teamId
        ? Boolean(await db.prepare("SELECT 1 AS ok FROM team_members WHERE team_id = ? AND user_id = ? AND role != 'guest'").get(teamId, userId))
        : Boolean(await db.prepare(`SELECT 1 AS ok WHERE ${ownerSpaceSql('?', '?')}`).get(userId, user.id, user.id, userId)),
  };
}
