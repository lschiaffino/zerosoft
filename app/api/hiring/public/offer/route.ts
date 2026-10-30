import { NextRequest } from 'next/server';
import { respondSchema, respondToOffer } from '@/lib/hiring/offers';
import { clientIp } from '@/lib/rate-limit';
import { hFail, hiringLimit, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { token, action: accept|decline, signedName, agree, reason }: respuesta del candidato a su oferta. */
export async function POST(req: NextRequest) {
  const limited = await hiringLimit(req, 'offer', 20, 600);
  if (limited) return limited;
  try {
    const input = await parseBody(req, respondSchema);
    const status = await respondToOffer(input, { ip: clientIp(req), ua: req.headers.get('user-agent') ?? '' });
    return hJson({ status });
  } catch (err) {
    return hFail(err);
  }
}
