import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sendHiringOffer } from '@/lib/sign/integrations';
import { parseBody, sFail, signActor, signLimit, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { offerId }: una oferta aprobada de Hiring sale a firmar con Sign (la
 * carta como PDF, el candidato de firmante). Completo, la oferta queda
 * aceptada y el candidato contratado; rechazado, la oferta queda rechazada.
 */
export async function POST(req: NextRequest) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const limited = await signLimit(req, 'hiring', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { offerId } = await parseBody(req, z.object({ offerId: z.string().min(1).max(80) }));
    const env = await sendHiringOffer(a.user, a.actor, offerId);
    return sJson({ envelopeId: env.id, href: `/app/sign/envelopes/${env.id}` }, 201);
  } catch (err) {
    return sFail(err);
  }
}
