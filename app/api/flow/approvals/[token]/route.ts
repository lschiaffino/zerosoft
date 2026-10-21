import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { APPROVAL_COMMENT_LIMIT, decideApproval } from '@/lib/flow-waits';
import { clientIp, isRateLimited, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MISSES_PER_IP = 60;

const bodySchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(APPROVAL_COMMENT_LIMIT).optional(),
});

/**
 * Decisión de un nodo Aprobación (desde la página /flow/approve/<token>).
 * Público: el token está firmado por corrida y nodo. La primera decisión
 * gana; el resto del flow corre después de responder.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limits = process.env.RATE_LIMIT_DISABLED !== 'true';
  const missKey = `flow-approval-miss:${clientIp(req)}`;
  if (limits && (await isRateLimited(missKey, MISSES_PER_IP, 60))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const res = await decideApproval(token, parsed.data.decision, parsed.data.comment ?? '', { background: true });
  if (!res.ok) {
    if (res.error === 'busy') return NextResponse.json({ error: 'busy' }, { status: 409 });
    if (limits) await rateLimit(missKey, MISSES_PER_IP, 60);
    return NextResponse.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 410 });
  }
  return NextResponse.json({ ok: true });
}
