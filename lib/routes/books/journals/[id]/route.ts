import { NextRequest } from 'next/server';
import { handle, must, need } from '@/lib/books-http';
import { getJournal } from '@/lib/books-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    return { journal: must(await getJournal(actor.ws, (await params).id)) };
  });
}
