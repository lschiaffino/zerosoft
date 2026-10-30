import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { createCreditNote, type LineInputDto } from '@/lib/books-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => { const b = await readJson(req); return { doc: await createCreditNote(actor, (await params).id, { lines: Array.isArray(b.lines) ? (b.lines as LineInputDto[]) : undefined, reason: b.reason ? String(b.reason) : undefined }) }; });
}
