import { NextRequest } from 'next/server';
import { z } from 'zod';
import { finalizeDerived, getVideoRow, toDto } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  durationSec: z.number().min(0).max(86_400),
  width: z.number().min(0).max(20_000).optional(),
  height: z.number().min(0).max(20_000).optional(),
  sources: z.array(z.string().max(60)).min(1).max(10),
  pieces: z.array(z.object({ src: z.number().int().min(0).max(10), from: z.number().min(0).max(86_400), to: z.number().min(0).max(86_400), at: z.number().min(0).max(86_400) })).max(5000),
});

/** Cierra una copia editada en el navegador: copia la transcripción de las fuentes, sin pasar por la cola de IA. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    await finalizeDerived(s.actor, id, parsed.data);
    const v = await getVideoRow(s.actor, id);
    return recJson({ video: toDto(v!, s.actor) });
  } catch (err) {
    return recFail(err);
  }
}
