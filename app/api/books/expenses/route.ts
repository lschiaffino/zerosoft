import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createExpense, listExpenses, type ExpenseInput } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'expenses.read');
    const sp = req.nextUrl.searchParams;
    return { expenses: await listExpenses(actor.ws, { q: sp.get('q') ?? undefined, status: sp.get('status') ?? undefined, accountId: sp.get('account') ?? undefined }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ expense: await createExpense(actor, (await readJson(req)) as ExpenseInput) }), 201);
}
