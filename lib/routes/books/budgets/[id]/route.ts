import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteBudget, getBudget, saveBudget } from '@/lib/books-accounting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    return { budget: must(await getBudget(actor.ws, (await params).id)) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ budget: await saveBudget(actor, { ...((await readJson(req)) as Parameters<typeof saveBudget>[1]), id: (await params).id }) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteBudget(actor, (await params).id);
    return { ok: true };
  });
}
