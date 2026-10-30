import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { deleteAccount, updateAccount } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { account: await updateAccount(actor, (await params).id, { code: b.code === undefined ? undefined : String(b.code), name: b.name === undefined ? undefined : String(b.name), archived: b.archived === undefined ? undefined : Boolean(b.archived) }) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteAccount(actor, (await params).id);
    return { ok: true };
  });
}
