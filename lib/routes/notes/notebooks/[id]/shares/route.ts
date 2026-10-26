import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sharesGet, sharesPatch } from '@/lib/notes-shares-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Con quién está compartida la libreta (todas sus notas, las de hoy y las que se sumen). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return sharesGet(await getCurrentUser(), { kind: 'notebook', id });
}

/** Comparte la libreta con una persona del workspace, le cambia el rol o la saca. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return sharesPatch(req, await getCurrentUser(), { kind: 'notebook', id });
}
