import type { DocsComment, DocsMentionableUser } from './docs-types';

/**
 * Hilos de comentarios de Docs: agrupar respuestas, detectar el `@` que se
 * está escribiendo en el composer y qué menciones cuentan para avisar. Puro
 * (lo usan el panel y la API).
 */

export interface DocsCommentThread {
  root: DocsComment;
  replies: DocsComment[];
}

/** Comentarios planos → hilos (raíz + respuestas por fecha). Una respuesta huérfana se muestra como raíz. */
export function groupCommentThreads(comments: DocsComment[]): DocsCommentThread[] {
  const roots = new Map<string, DocsCommentThread>();
  const order: DocsCommentThread[] = [];
  for (const c of comments) {
    if (!c.parent_id) {
      const thread = { root: c, replies: [] };
      roots.set(c.id, thread);
      order.push(thread);
    }
  }
  for (const c of [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!c.parent_id) continue;
    const thread = roots.get(c.parent_id);
    if (thread) thread.replies.push(c);
    else {
      const orphan = { root: c, replies: [] };
      order.push(orphan);
    }
  }
  return order;
}

/** `@query` justo antes del caret (al inicio o tras un espacio), o null. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

/** Texto visible de una mención (`@Nombre` o `@email` si no tiene nombre). */
export function mentionLabel(user: Pick<DocsMentionableUser, 'name' | 'email'>): string {
  return `@${user.name || user.email}`;
}

/** Reemplaza el `@query` en curso por la mención y un espacio. */
export function insertMention(
  text: string,
  at: { start: number; query: string },
  user: Pick<DocsMentionableUser, 'name' | 'email'>,
): { text: string; caret: number } {
  const label = `${mentionLabel(user)} `;
  const end = at.start + 1 + at.query.length;
  return { text: text.slice(0, at.start) + label + text.slice(end), caret: at.start + label.length };
}

/**
 * A quién avisar: los elegidos en el popover que son del workspace de la
 * página y siguen nombrados en el texto final (si se borró la mención, no se avisa).
 */
export function mentionedInBody(body: string, mentionables: DocsMentionableUser[], ids: string[]): string[] {
  const lower = body.toLowerCase();
  const out: string[] = [];
  for (const id of ids) {
    const user = mentionables.find((m) => m.id === id);
    if (!user || out.includes(id)) continue;
    const labels = [user.name, user.email].filter(Boolean).map((l) => `@${String(l).toLowerCase()}`);
    if (labels.some((l) => lower.includes(l))) out.push(id);
  }
  return out;
}

/** Partes del cuerpo para resaltar las menciones conocidas (texto plano, sin HTML). */
export function commentBodyParts(body: string, names: string[]): Array<{ text: string; mention: boolean }> {
  const labels = [...new Set(names.filter(Boolean).map((n) => `@${n}`))].sort((a, b) => b.length - a.length);
  if (!labels.length) return [{ text: body, mention: false }];
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  return body
    .split(re)
    .filter((p) => p !== '')
    .map((text) => ({ text, mention: labels.includes(text) }));
}
