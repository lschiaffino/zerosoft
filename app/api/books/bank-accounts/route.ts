import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createBankAccount, listBankAccounts } from '@/lib/books-bank';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'banking.read');
    return { accounts: await listBankAccounts(actor.ws, { includeArchived: req.nextUrl.searchParams.get('archived') === '1' }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { account: await createBankAccount(actor, { name: String(b.name ?? ''), bankName: b.bankName ? String(b.bankName) : undefined, last4: b.last4 ? String(b.last4) : undefined, currency: b.currency ? String(b.currency) : undefined }) };
  }, 201);
}
