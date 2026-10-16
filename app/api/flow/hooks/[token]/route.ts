import { NextRequest, NextResponse } from 'next/server';
import { enqueueWebhookRun } from '@/lib/flow';
import { clientIp, isRateLimited, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 256_000;
/** Por token (identifica al flow): el límite principal. */
const PER_TOKEN_LIMIT = 600;
/**
 * Por IP solo se cuentan los tokens inexistentes o apagados: frena a quien
 * prueba tokens sin castigar a emisores compartidos entre workspaces (Stripe,
 * GitHub, Zapier mandan desde pocas IPs).
 */
const MISSES_PER_IP = 120;
/** Headers que no se pasan al flow (credenciales e infraestructura). */
const DROP_HEADERS = /^(cookie|authorization|proxy-authorization|x-vercel-.*|x-forwarded-.*|x-real-ip|forwarded)$/i;

/**
 * Webhook entrante de un flow (trigger.webhook). Público: la autenticación es
 * el token (secreto, uno por nodo). Encola la corrida y responde 202 al
 * instante; body/query/headers quedan como {{trigger.body}}, {{trigger.query}}…
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^fh_[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const limits = process.env.RATE_LIMIT_DISABLED !== 'true';
  const missKey = `flow-hook-miss:${clientIp(req)}`;
  if (limits) {
    if (await isRateLimited(missKey, MISSES_PER_IP, 60)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    const perToken = await rateLimit(`flow-hook-token:${token}`, PER_TOKEN_LIMIT, 60);
    if (!perToken.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const raw = await req.text().catch(() => '');
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  let body: unknown = raw;
  const type = req.headers.get('content-type') ?? '';
  if (raw && type.includes('application/json')) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
  } else if (raw && type.includes('application/x-www-form-urlencoded')) {
    body = Object.fromEntries(new URLSearchParams(raw));
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (!DROP_HEADERS.test(k) && Object.keys(headers).length < 40) headers[k] = v.slice(0, 1000);
  });
  const query = Object.fromEntries(req.nextUrl.searchParams);

  const res = await enqueueWebhookRun(
    token,
    { method: 'POST', body, query, headers },
    { body: raw, signature: req.headers.get('stripe-signature') },
  );
  if (!res.ok) {
    if (res.error === 'rate_limited') return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    if (res.error === 'invalid_signature') return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    // Flow apagado o token inexistente: misma respuesta (no revela cuál).
    if (limits) await rateLimit(missKey, MISSES_PER_IP, 60);
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (res.ignored) return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  return NextResponse.json({ ok: true, runId: res.runId }, { status: 202 });
}
