import { getCurrentUser } from './session';
import { isAdminEmail } from './feedback';

/**
 * Persona del board: siempre la identidad real (no el owner del workspace
 * activo), porque votos y comentarios son personales.
 */
export interface BoardPerson {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isAdmin: boolean;
}

export async function getBoardPerson(): Promise<BoardPerson | null> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  const person = user.actingUser ?? user;
  return {
    id: person.id,
    email: person.email,
    name: person.name,
    image: person.image,
    isAdmin: isAdminEmail(person.email),
  };
}

/** Locale para los emails: el que manda el cliente, o el del Referer, o en. */
export function localeFromRequest(req: Request, explicit?: unknown): string {
  if (explicit === 'es' || explicit === 'pt' || explicit === 'en') return explicit;
  const ref = req.headers.get('referer') ?? '';
  const m = /^https?:\/\/[^/]+\/(en|es|pt)(?:\/|$)/.exec(ref);
  return m ? m[1] : 'en';
}
