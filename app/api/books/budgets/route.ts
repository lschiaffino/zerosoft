import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { listBudgets, saveBudget } from '@/lib/books-accounting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    return { budgets: await listBudgets(actor.ws) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const { id: _id, ...b } = await readJson(req);
    return { budget: await saveBudget(actor, b as Parameters<typeof saveBudget>[1]) };
  }, 201);
}
