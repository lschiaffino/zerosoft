import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteExpense, getExpense, updateExpense, type ExpenseInput } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'expenses.read');
    return { expense: must(await getExpense(actor.ws, (await params).id)) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ expense: await updateExpense(actor, (await params).id, (await readJson(req)) as ExpenseInput) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteExpense(actor, (await params).id);
    return { ok: true };
  });
}
