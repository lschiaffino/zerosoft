/**
 * API pública de Notes (/api/v1/notes): API key con notes:read o notes:write,
 * que actúa como la persona que la creó. Respeta el acceso por app y solo ve
 * las notas de esa persona. Una nota bloqueada no devuelve contenido. Server-only.
 */
import { NextResponse } from 'next/server';
import { apiError, personAppAccess, requireApiUser, type ApiKeyAuth } from './api-auth';
import type { ApiScope } from './api-scopes';
import { canUseApp } from './workspace';
import { blocksToMarkdown } from './docs-markdown';
import type { DocsBlock } from './docs-types';
import { markdownToNote } from './notes-import';
import { NotesError, type NoteOwner } from './notes';
import type { NoteDetail, NoteSummary } from './notes-types';

export async function notesApi(req: Request, scope: Extract<ApiScope, 'notes:read' | 'notes:write'>): Promise<{ res: NextResponse } | { auth: ApiKeyAuth; owner: NoteOwner }> {
  const auth = await requireApiUser(req, scope);
  if ('res' in auth) return auth;
  const access = await personAppAccess(auth.user.id, auth.personId);
  if (!access || !canUseApp({ role: access.role, apps: access.apps as never }, 'notes')) return { res: apiError(403, 'app_forbidden', 'The key owner cannot use Notes.') };
  return { auth, owner: { workspaceId: auth.user.id, personId: auth.personId } };
}

export function summaryDto(n: NoteSummary) {
  return {
    id: n.id,
    title: n.title,
    snippet: n.locked ? '' : n.snippet,
    notebookId: n.notebook_id,
    tags: n.tags,
    pinned: n.pinned,
    trashed: n.trashed,
    locked: Boolean(n.locked),
    sourceUrl: n.source_url,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  };
}

export function detailDto(n: NoteDetail) {
  return { ...summaryDto(n), markdown: n.lock ? null : blocksToMarkdown(n.content), blocks: n.lock ? [] : n.content };
}

/** Contenido de un pedido: Markdown o bloques. */
export function inputBlocks(input: { markdown?: string; blocks?: unknown[] }): DocsBlock[] | undefined {
  if (input.blocks) return input.blocks as DocsBlock[];
  if (input.markdown !== undefined) return markdownToNote(input.markdown).blocks;
  return undefined;
}

export function notesV1Error(err: unknown): NextResponse {
  if (err instanceof NotesError) {
    const status = err.code === 'notebook_not_found' ? 400 : err.code === 'note_locked' ? 423 : 409;
    return apiError(status, err.code, err.code.replace(/_/g, ' '));
  }
  throw err;
}
