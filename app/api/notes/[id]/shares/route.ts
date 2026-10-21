import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sharesGet, sharesPatch } from '@/lib/notes-shares-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Con quién del workspace está compartida la nota (y con quién se puede compartir). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return sharesGet(await getCurrentUser(), { kind: 'note', id });
}

/** Comparte la nota con una persona del workspace, le cambia el rol o la saca. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return sharesPatch(req, await getCurrentUser(), { kind: 'note', id });
}
