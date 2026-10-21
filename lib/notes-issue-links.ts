/**
 * Notes → Track: helpers puros (sin DB) de los links entre tareas e issues.
 * Los usan el servidor (lib/notes-track.ts) y el drawer del cliente.
 */
import type { DocsBlock } from './docs-types';
import { htmlLiteToText, noteHref } from './notes-types';

/** Ruta (sin locale) de un issue de Track. */
export function trackIssueHref(issueId: string): string {
  return `/app/track/issues/${encodeURIComponent(issueId)}`;
}

const ISSUE_LINK_RE = /<a [^>]*href="\/app\/track\/issues\/[^"]+"/;

/** ¿La tarea ya tiene un issue linkeado? (no se crea otro). Puro. */
export function hasIssueLink(html: string): boolean {
  return ISSUE_LINK_RE.test(html);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Link al issue en el HTML-lite de Notes. Puro. */
export function issueLinkHtml(issue: { id: string; identifier: string }): string {
  return `<a href="${trackIssueHref(issue.id)}">${escapeHtml(issue.identifier)}</a>`;
}

/** Título de un issue a partir de una tarea (texto plano, una línea, hasta 200). Puro. */
export function todoIssueTitle(html: string): string {
  const flat = htmlLiteToText(html).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

/** Descripción Markdown del issue con el link de vuelta a la nota. Puro. */
export function noteIssueDescription(body: string, noteId: string, noteTitle: string, fromLabel = 'From note'): string {
  const name = noteTitle.replace(/[[\]]/g, '').trim() || 'Note';
  const link = `${fromLabel}: [${name}](${noteHref(noteId)})`;
  return body.trim() ? `${body.trim()}\n\n${link}` : link;
}

/** Bloques con el link al issue agregado al final de cada tarea convertida. Puro. */
export function linkTodos(blocks: DocsBlock[], issues: ReadonlyMap<string, { id: string; identifier: string }>): DocsBlock[] {
  return blocks.map((b) => {
    const issue = issues.get(b.id);
    if (!issue) return b;
    return { ...b, content: `${b.content.replace(/\s+$/, '')} ${issueLinkHtml(issue)}` };
  });
}
