import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteBankAccount, listBankAccounts, listTxns, suggestions, updateBankAccount } from '@/lib/books-bank';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: la cuenta, sus movimientos (?status=) y las sugerencias para los pendientes. */
export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'banking.read');
    const id = (await params).id;
    const account = must((await listBankAccounts(actor.ws, { includeArchived: true })).find((b) => b.id === id));
    const status = req.nextUrl.searchParams.get('status') ?? undefined;
    return { account, transactions: await listTxns(actor.ws, id, { status }), suggestions: await suggestions(actor.ws, id) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return {
      account: await updateBankAccount(actor, (await params).id, {
        name: b.name === undefined ? undefined : String(b.name),
        bankName: b.bankName === undefined ? undefined : String(b.bankName),
        last4: b.last4 === undefined ? undefined : String(b.last4),
        archived: b.archived === undefined ? undefined : Boolean(b.archived),
      }),
    };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => deleteBankAccount(actor, (await params).id));
}
