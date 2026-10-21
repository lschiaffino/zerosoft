/**
 * Notes → Track: una nota entera o tareas elegidas de la nota pasan a ser
 * issues. El issue lleva un link a la nota ("Desde la nota") y la nota queda
 * con el link al issue (al lado de cada tarea, o en un párrafo al final si
 * fue la nota entera), así se puede ir y volver.
 */
import { blocksToMarkdown } from './docs-markdown';
import { resolveBlocksPageLinks } from './docs-page-links';
import type { DocsBlock } from './docs-types';
import { htmlLiteToText } from './notes-types';
import { issueLinkHtml, linkTodos, hasIssueLink, noteIssueDescription, todoIssueTitle } from './notes-issue-links';
import { getNote, NotesConflictError, updateNote, type NoteOwner } from './notes';
import { canAccessTrackProject, createIssue, getProject } from './track-data';

export { hasIssueLink, issueLinkHtml, linkTodos, noteIssueDescription, todoIssueTitle, trackIssueHref } from './notes-issue-links';

export type NoteTrackResult =
  | { ok: true; issues: Array<{ id: string; identifier: string; title: string }>; skipped: number }
  | { ok: false; code: 'not_found' | 'project_not_found' | 'conflict' | 'trashed' | 'nothing_to_send' };

/**
 * Crea los issues y deja los links en la nota. `owner` es el dueño de la
 * nota (quien llama ya chequeó que la puede editar). Si la nota cambió desde
 * `baseUpdatedAt`, no se crea nada (conflict).
 */
export async function sendNoteToTrack(args: {
  owner: NoteOwner;
  teamId: string | null;
  personId: string;
  noteId: string;
  projectId: string;
  blockIds?: string[];
  baseUpdatedAt?: string;
  fromLabel?: string;
}): Promise<NoteTrackResult> {
  const note = await getNote(args.owner, args.noteId);
  if (!note) return { ok: false, code: 'not_found' };
  if (note.trashed) return { ok: false, code: 'trashed' };
  if (args.baseUpdatedAt && note.updated_at !== args.baseUpdatedAt) return { ok: false, code: 'conflict' };
  const project = await getProject(args.projectId);
  if (!project || !canAccessTrackProject(project, args.teamId, args.owner.workspaceId)) return { ok: false, code: 'project_not_found' };

  const created: Array<{ id: string; identifier: string; title: string }> = [];
  let skipped = 0;
  let content: DocsBlock[];

  if (args.blockIds?.length) {
    const wanted = new Set(args.blockIds);
    const linked = new Map<string, { id: string; identifier: string }>();
    for (const b of note.content) {
      if (!wanted.has(b.id)) continue;
      const title = b.type === 'todo' ? todoIssueTitle(b.content) : '';
      if (!title || hasIssueLink(b.content)) {
        skipped += 1;
        continue;
      }
      const issue = await createIssue(
        project.id,
        args.personId,
        { title, description: [{ type: 'text', text: noteIssueDescription('', note.id, note.title, args.fromLabel) }] },
        { source: 'app' },
      );
      linked.set(b.id, issue);
      created.push({ id: issue.id, identifier: issue.identifier, title: issue.title });
    }
    if (!created.length) return { ok: false, code: 'nothing_to_send' };
    content = linkTodos(note.content, linked);
  } else {
    const firstLine = note.content.map((b) => htmlLiteToText(b.content).trim()).find(Boolean) ?? '';
    const title = (note.title.trim() || firstLine).slice(0, 200);
    if (!title) return { ok: false, code: 'nothing_to_send' };
    // Quien la recibió compartida no ve los títulos de las otras notas del dueño: los [[ ]] van como texto.
    const source = args.personId === args.owner.personId ? note.content : resolveBlocksPageLinks(note.content, () => null);
    const body = blocksToMarkdown(source).slice(0, 4500);
    const issue = await createIssue(
      project.id,
      args.personId,
      { title, description: [{ type: 'text', text: noteIssueDescription(body, note.id, note.title, args.fromLabel) }] },
      { source: 'app' },
    );
    created.push({ id: issue.id, identifier: issue.identifier, title: issue.title });
    content = [...note.content, { id: crypto.randomUUID(), type: 'paragraph', content: `Track: ${issueLinkHtml(issue)}` }];
  }

  try {
    await updateNote(args.owner, note.id, { content, base_updated_at: note.updated_at });
  } catch (err) {
    // Se guardó algo entre la lectura y acá: los issues quedan creados (con su
    // link a la nota) y la nota no se toca; el cliente recarga.
    if (err instanceof NotesConflictError) return { ok: true, issues: created, skipped };
    throw err;
  }
  return { ok: true, issues: created, skipped };
}
