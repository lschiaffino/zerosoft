/** Calls: quién actúa, sin traer nada más: lo usan rutas de otras apps, como la búsqueda. */
import type { SessionUser } from '../session';
import type { CallsActor } from './types';

export function callsActorOf(user: SessionUser): CallsActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, person: person.id, admin: user.role === 'owner' || user.role === 'admin', email: (person.email ?? '').toLowerCase(), name: person.name ?? person.email ?? '' };
}
