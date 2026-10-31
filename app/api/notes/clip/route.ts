import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { emitEventSoon } from '@/lib/events';
import { createNote, noteOwner } from '@/lib/notes';
import { noteClipSchema } from '@/lib/notes-schema';
import { clipBlocks, noteEventPayload } from '@/lib/notes-types';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { CLIP_MAX_HTML, ClipFetchError, clipContentBlocks, fetchClipHtml } from '@/lib/notes-clip';
import type { DocsBlock } from '@/lib/docs-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Guarda una página recortada (bookmarklet "Clip page") como nota con su URL de origen. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteClipSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const { url, title, selection, mode, html } = parsed.data;
  // Selección o marcador: lo que viene en el pedido. Artículo o página: el HTML
  // del bookmarklet (la página como la ve la persona) o, sin él, el que baja el servidor.
  let content: DocsBlock[] = clipBlocks(url, mode === 'bookmark' ? '' : (selection ?? ''));
  if (mode === 'article' || mode === 'page') {
    try {
      const source = html ? Buffer.from(html).subarray(0, CLIP_MAX_HTML).toString() : await fetchClipHtml(url);
      const blocks = await clipContentBlocks(source, mode, url);
      if (!blocks.length) return jsonError(422, 'empty_page');
      content = [...clipBlocks(url, ''), ...blocks];
    } catch (err) {
      if (err instanceof ClipFetchError) return jsonError(422, 'fetch_failed');
      throw err;
    }
  }
  const note = await createNote(owner, {
    title: (title?.trim() || url).slice(0, 300),
    source_url: url,
    content,
    tags: ['clip'],
  });
  await emitEventSoon(owner.workspaceId, 'note.created', noteEventPayload(note, owner.personId));
  return NextResponse.json(note, { status: 201 });
}
