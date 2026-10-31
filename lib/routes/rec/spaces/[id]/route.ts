import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteSpace, getSpace, renameSpace } from '@/lib/rec-admin';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const space = await getSpace(s.actor, id);
  return space ? recJson({ space }) : recJson({ error: 'not_found' }, 404);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = z.object({ name: z.string().max(120) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    return recJson({ space: await renameSpace(s.actor, id, parsed.data.name) });
  } catch (err) {
    return recFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    await deleteSpace(s.actor, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return recFail(err);
  }
}
