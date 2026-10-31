import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { docsBlockSchema } from '@/lib/docs-schema';
import { getNote, trashNote, updateNote } from '@/lib/notes';
import { detailDto, inputBlocks, notesApi, notesV1Error } from '@/lib/notes-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/notes/:id */
export async function GET(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await notesApi(req, 'notes:read');
  if ('res' in ctx) return ctx.res;
  const note = await getNote(ctx.owner, id);
  if (!note) return apiError(404, 'not_found', 'Note not found.');
  return NextResponse.json({ data: detailDto(note) });
}

const patchSchema = z.object({
  title: z.string().max(300).optional(),
  markdown: z.string().max(400_000).optional(),
  blocks: z.array(docsBlockSchema).max(1000).optional(),
  notebookId: z.string().max(64).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  pinned: z.boolean().optional(),
});

/** PATCH /api/v1/notes/:id */
export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await notesApi(req, 'notes:write');
  if ('res' in ctx) return ctx.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    const { title, notebookId, tags, pinned } = parsed.data;
    const note = await updateNote(ctx.owner, id, { title, notebook_id: notebookId, tags, pinned, content: inputBlocks(parsed.data) });
    if (!note) return apiError(404, 'not_found', 'Note not found.');
    return NextResponse.json({ data: detailDto(note) });
  } catch (err) {
    return notesV1Error(err);
  }
}

/** DELETE /api/v1/notes/:id: a la papelera. */
export async function DELETE(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await notesApi(req, 'notes:write');
  if ('res' in ctx) return ctx.res;
  if (!(await trashNote(ctx.owner, id))) return apiError(404, 'not_found', 'Note not found.');
  return NextResponse.json({ data: { id, trashed: true } });
}
