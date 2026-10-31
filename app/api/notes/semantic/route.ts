import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { jsonError, limitWrites } from '@/lib/write-limit';
import { AiError } from '@/lib/ai';
import { getDb, type NoteRow } from '@/lib/db';
import { notesSemanticEnabled, semanticNoteIds } from '@/lib/notes-semantic';
import { makeSnippet, type NoteSummary } from '@/lib/notes-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Busca por significado en las notas propias. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 200) ?? '';
  if (!q) return NextResponse.json({ notes: [] });
  if (!notesSemanticEnabled()) return jsonError(503, 'ai_disabled');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:semantic', owner.personId, 60);
  if (limited) return limited;
  try {
    const { ids, degraded } = await semanticNoteIds(owner, q);
    if (!ids.length) return NextResponse.json({ notes: [], degraded });
    const rows = (await getDb()
      .prepare(`SELECT * FROM notes WHERE id IN (${ids.map(() => '?').join(',')}) AND workspace_id = ? AND person_id = ?`)
      .all(...ids, owner.workspaceId, owner.personId)) as NoteRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const notes: NoteSummary[] = ids.flatMap((id) => {
      const r = byId.get(id);
      if (!r) return [];
      return [{
        id: r.id,
        notebook_id: r.notebook_id,
        title: r.title,
        snippet: makeSnippet(r.body_text),
        tags: JSON.parse(r.tags || '[]') as string[],
        pinned: Boolean(r.pinned),
        trashed: false,
        source_url: r.source_url,
        shared: r.share_token != null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }];
    });
    return NextResponse.json({ notes, degraded });
  } catch (err) {
    if (err instanceof AiError) return jsonError(err.code === 'ai_disabled' ? 503 : 429, err.code);
    throw err;
  }
}
