import { NextRequest } from 'next/server';
import { z } from 'zod';
import { heartbeat, leavePresence } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Latido del editor (cada pocos segundos): marca a la persona en la página
 * que mira y devuelve quién más está y la versión guardada (si cambió y no
 * hay cambios propios sin guardar, el editor trae la nueva).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const s = await designActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = z.object({ pageId: z.string().max(64) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    return designJson(await heartbeat(s.actor, id, parsed.data.pageId));
  } catch (err) {
    return designFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const s = await designActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  await leavePresence(s.actor, id);
  return new Response(null, { status: 204 });
}
