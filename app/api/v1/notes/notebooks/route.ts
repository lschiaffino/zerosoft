import { NextResponse } from 'next/server';
import { listNotebooks } from '@/lib/notes';
import { notesApi } from '@/lib/notes-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/notes/notebooks */
export async function GET(req: Request) {
  const ctx = await notesApi(req, 'notes:read');
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ data: await listNotebooks(ctx.owner) });
}
