import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createAccount, listAccounts } from '@/lib/books';
import type { AccountType } from '@/lib/books-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/accounts: plan de cuentas (las archivadas con ?archived=1). */
export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'invoices.read');
    return { accounts: await listAccounts(actor.ws, { includeArchived: req.nextUrl.searchParams.get('archived') === '1' }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { account: await createAccount(actor, { code: String(b.code ?? ''), name: String(b.name ?? ''), type: String(b.type ?? '') as AccountType, subtype: b.subtype ? String(b.subtype) : undefined }) };
  }, 201);
}
