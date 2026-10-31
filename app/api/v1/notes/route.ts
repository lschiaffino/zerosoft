import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { docsBlockSchema } from '@/lib/docs-schema';
import { emitEventSoon } from '@/lib/events';
import { createNote, listNotes } from '@/lib/notes';
import { noteEventPayload } from '@/lib/notes-types';
import { detailDto, inputBlocks, notesApi, notesV1Error, summaryDto } from '@/lib/notes-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/notes?q=&notebook=&tag=&limit=&offset= */
export async function GET(req: Request) {
  const ctx = await notesApi(req, 'notes:read');
  if ('res' in ctx) return ctx.res;
  const p = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(p.get('limit')) || 50, 1), 200);
  const offset = Math.max(Math.floor(Number(p.get('offset')) || 0), 0);
  const rows = await listNotes(ctx.owner, { q: p.get('q')?.slice(0, 200) ?? null, notebookId: p.get('notebook'), tag: p.get('tag'), limit: limit + 1, offset });
  return NextResponse.json({ data: rows.slice(0, limit).map(summaryDto), hasMore: rows.length > limit });
}

const createSchema = z.object({
  title: z.string().max(300).optional(),
  markdown: z.string().max(400_000).optional(),
  blocks: z.array(docsBlockSchema).max(1000).optional(),
  notebookId: z.string().max(64).nullish(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  pinned: z.boolean().optional(),
});

/** POST /api/v1/notes */
export async function POST(req: Request) {
  const ctx = await notesApi(req, 'notes:write');
  if ('res' in ctx) return ctx.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    const { title, notebookId, tags, pinned } = parsed.data;
    const note = await createNote(ctx.owner, { title, notebook_id: notebookId ?? null, tags, pinned, content: inputBlocks(parsed.data) });
    await emitEventSoon(ctx.owner.workspaceId, 'note.created', noteEventPayload(note, ctx.owner.personId));
    return NextResponse.json({ data: detailDto(note) }, { status: 201 });
  } catch (err) {
    return notesV1Error(err);
  }
}
