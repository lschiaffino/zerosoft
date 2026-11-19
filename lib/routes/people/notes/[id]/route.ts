import { NextRequest } from 'next/server';
import { deleteNote, updateNote } from '@/lib/people-notes';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Editar una nota (solo quien la escribió). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ note: await updateNote(ctx, (await params).id, await readJson(req)) }));
}

/** Borrar una nota (quien la escribió o HR). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    await deleteNote(ctx, (await params).id);
    return pjson({ ok: true });
  });
}
