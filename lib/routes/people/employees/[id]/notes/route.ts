import { NextRequest } from 'next/server';
import { addNote, listNotes } from '@/lib/people-notes';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Notas sobre la persona (HR y su cadena de managers; la persona no). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ notes: await listNotes(ctx, (await params).id) }));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ note: await addNote(ctx, (await params).id, await readJson(req)) }, 201));
}
