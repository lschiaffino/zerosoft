/**
 * Cal — token opaco para "reservar con esta persona" (?host= de la página del
 * equipo y del routing por owner del CRM). Es el id de la persona cifrado con
 * lib/secret-box (AES-GCM): no se puede leer ni falsificar, así el link no
 * expone ids internos ni deja elegir a cualquiera. Un token inválido o de
 * alguien fuera del pool se ignora (reparto de siempre). Server-only.
 */
import { open, seal } from './secret-box';

const PREFIX = 'h1:';

export function hostToken(userId: string): string {
  return seal(`${PREFIX}${userId}`);
}

/** El id de la persona, o null si el token no es nuestro. */
export function parseHostToken(token: string | null | undefined): string | null {
  // Solo tokens cifrados: open() deja pasar texto plano heredado, que acá no vale.
  if (!token || token.length > 400 || !token.startsWith('enc:v1:')) return null;
  const plain = open(token);
  return plain.startsWith(PREFIX) ? plain.slice(PREFIX.length) || null : null;
}
