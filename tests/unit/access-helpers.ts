/**
 * Ayudas para las pruebas de acceso: un workspace con su owner y dos personas,
 * otro workspace ajeno, y las sesiones de cada uno tal como las arma
 * getCurrentUser (en un workspace ajeno, `id` es el del owner y `actingUser` la
 * persona real).
 *
 * Para probar una ruta por rol, mockear la sesión en el test:
 *
 *   const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
 *   vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
 *
 * y recorrer `roles(w)` con `session.user = r.user` (anónimo = null).
 */
import type { UserRow } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

export function asOwner(owner: UserRow): SessionUser {
  return { ...owner, role: 'owner', apps: '*' } as SessionUser;
}

export function asMember(owner: UserRow, person: UserRow, role: SessionUser['role'] = 'member', apps: SessionUser['apps'] = '*'): SessionUser {
  return { ...owner, actingUser: person, role, apps } as SessionUser;
}

/** Owner, una persona del equipo (`member`) y otra (`friend`), más un workspace ajeno (`stranger`). */
export async function workspaceWithMember(label = 'acc') {
  const owner = await makeUser(`${label}-owner`);
  const member = await makeUser(`${label}-member`);
  const friend = await makeUser(`${label}-friend`);
  const stranger = await makeUser(`${label}-stranger`);
  const team = await createTeam(owner.id, 'Team');
  await addMember(team.id, member.id, 'member');
  await addMember(team.id, friend.id, 'member');
  return { owner, member, friend, stranger, team };
}

export type AccessWorkspace = Awaited<ReturnType<typeof workspaceWithMember>>;

/** Las cuatro miradas de una prueba de acceso: anónimo, otro workspace, compañero sin acceso y owner. */
export function roles(w: AccessWorkspace): Array<{ name: 'anonymous' | 'other_workspace' | 'teammate' | 'owner'; user: SessionUser | null }> {
  return [
    { name: 'anonymous', user: null },
    { name: 'other_workspace', user: asOwner(w.stranger) },
    { name: 'teammate', user: asMember(w.owner, w.member) },
    { name: 'owner', user: asOwner(w.owner) },
  ];
}
