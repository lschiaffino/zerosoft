import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { reverseManualJournal } from '@/lib/books-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { date? }: reversa de un asiento manual (los de documentos se corrigen anulando o con nota de crédito). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { journal: await reverseManualJournal(actor, (await params).id, b.date ? String(b.date) : undefined) };
  }, 201);
}
