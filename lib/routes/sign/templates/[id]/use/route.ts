import { NextRequest } from 'next/server';
import { z } from 'zod';
import { bulkSend, envelopeFromTemplate } from '@/lib/sign/templates';
import { parseBody, sFail, signActor, signLimit, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const person = z.object({ name: z.string().max(120), email: z.string().max(254) });
const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('use'), title: z.string().max(200).optional(), message: z.string().max(4000).optional(), recipients: z.record(person), send: z.boolean().optional(), locale: z.string().max(5).optional() }),
  z.object({ mode: z.literal('bulk'), csv: z.string().max(200_000), fixed: z.record(person).optional(), locale: z.string().max(5).optional(), bulkId: z.string().max(60).optional(), offset: z.number().int().min(0).max(100_000).optional() }),
]);

/** POST: { mode: 'use' } arma un sobre (y lo envía con send); { mode: 'bulk' } manda uno por fila del CSV. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const limited = await signLimit(req, 'use', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const id = (await params).id;
    const input = await parseBody(req, schema);
    if (input.mode === 'bulk') return sJson(await bulkSend(a.actor, id, input));
    const env = await envelopeFromTemplate(a.actor, id, input);
    return sJson({ id: env.id, status: env.status }, 201);
  } catch (err) {
    return sFail(err);
  }
}
