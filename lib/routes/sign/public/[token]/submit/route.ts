import { NextRequest } from 'next/server';
import { z } from 'zod';
import { declineSigning, submitSigning } from '@/lib/sign/signing';
import { publicResolve, type PublicCtx } from '@/lib/sign/public-http';
import { metaOf, parseBody, sFail, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('sign'),
    consent: z.boolean(),
    values: z.record(z.union([z.string().max(500), z.boolean()])),
    signature: z.string().max(300_000).nullable().optional(),
    signatureKind: z.enum(['typed', 'drawn', 'upload']).nullable().optional(),
    initials: z.string().max(300_000).nullable().optional(),
  }),
  z.object({ action: z.literal('decline'), reason: z.string().max(1000) }),
]);

/**
 * POST { action: 'sign' }: firma (o aprueba) con el consentimiento, los
 * valores de sus campos (un campo ajeno es 403) y la firma. { action:
 * 'decline', reason }: rechaza el sobre entero.
 */
export async function POST(req: NextRequest, ctx: PublicCtx) {
  const p = await publicResolve(req, ctx, 'submit', 30);
  if ('res' in p) return p.res;
  try {
    const input = await parseBody(req, schema);
    if (input.action === 'decline') {
      await declineSigning(p.r, p.sessionOk, input.reason, metaOf(req));
      return sJson({ ok: true, state: 'declined' });
    }
    const res = await submitSigning(p.r, p.sessionOk, input, metaOf(req));
    return sJson({ ok: true, state: res.completed ? 'completed' : 'done' });
  } catch (err) {
    return sFail(err);
  }
}
