import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createManualJournal, listJournals, type JournalLineInput } from '@/lib/books-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    const sp = req.nextUrl.searchParams;
    return {
      journals: await listJournals(actor.ws, {
        from: sp.get('from') ?? undefined,
        to: sp.get('to') ?? undefined,
        accountId: sp.get('account') ?? undefined,
        sourceType: sp.get('source') ?? undefined,
        q: sp.get('q') ?? undefined,
      }),
    };
  });
}

/** POST { date, memo, lines: [{ accountId, debit, credit, description }] }: asiento manual (tiene que balancear). */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { journal: await createManualJournal(actor, { date: String(b.date ?? ''), memo: b.memo ? String(b.memo) : '', lines: Array.isArray(b.lines) ? (b.lines as JournalLineInput[]) : [] }) };
  }, 201);
}
