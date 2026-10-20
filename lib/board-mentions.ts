/**
 * Board — autocompletado de @menciones en los comentarios. Puro (lo usa el
 * textarea del cliente; el servidor resuelve las menciones en lib/board-comments.ts).
 */

export interface MentionMember {
  id: string;
  name: string | null;
  email: string;
}

/** Lo que se está escribiendo después de una @ (o null si no hay mención en curso). */
export function mentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

/** Miembros que coinciden con lo escrito (nombre o email, sin importar mayúsculas). */
export function filterMembers(members: MentionMember[], query: string, limit = 6): MentionMember[] {
  const q = query.toLowerCase();
  return members
    .filter((m) => !q || (m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    .slice(0, limit);
}

/** Inserta la mención elegida en lugar de la @consulta. Devuelve el texto y el cursor. */
export function insertMention(
  value: string,
  caret: number,
  member: MentionMember,
): { value: string; caret: number } | null {
  const q = mentionQuery(value, caret);
  if (!q) return null;
  const token = `@${member.name?.trim() || member.email} `;
  return { value: value.slice(0, q.start) + token + value.slice(caret), caret: q.start + token.length };
}
