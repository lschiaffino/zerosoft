import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { deleteRule, updateRule, type RuleInput } from '@/lib/books-bankrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ rule: await updateRule(actor, (await params).id, (await readJson(req)) as RuleInput) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteRule(actor, (await params).id);
    return { ok: true };
  });
}
