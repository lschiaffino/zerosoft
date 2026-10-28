import { after, NextRequest, NextResponse } from 'next/server';
import { enqueueWebhookRun, webhookReply } from '@/lib/flow';
import { executeRun } from '@/lib/flow-engine';
import { clientIp, isRateLimited, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Con respond = reply_node la corrida se ejecuta dentro del request.
export const maxDuration = 60;

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

/** Cuánto espera la respuesta del nodo "Responder al webhook" antes de contestar 202 (la corrida sigue). */
const REPLY_WAIT_MS = 25_000;

/**
 * Webhook entrante de un flow (trigger.webhook / trigger.stripe). Público: la
 * autenticación es el token (secreto, uno por nodo) y, si el trigger tiene
 * credencial, un header o usuario y contraseña. Acepta POST y, si el trigger
 * lo permite, GET. Por defecto encola la corrida y responde 202 al instante;
 * con respond = reply_node la ejecuta y responde con el nodo "Responder al
 * webhook" (o 202 si no llegó a correr a tiempo). body/query/headers quedan
 * como {{trigger.body}}, {{trigger.query}}…
 */
async function handle(req: NextRequest, props: { params: Promise<{ token: string }> }, method: 'GET' | 'POST') {
  const { token } = await props.params;
  if (!/^fh_[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const limits = process.env.RATE_LIMIT_DISABLED !== 'true';
  const missKey = `flow-hook-miss:${clientIp(req)}`;
  if (limits) {
    if (await isRateLimited(missKey, MISSES_PER_IP, 60)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    const perToken = await rateLimit(`flow-hook-token:${token}`, PER_TOKEN_LIMIT, 60);
    if (!perToken.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const raw = method === 'POST' ? await req.text().catch(() => '') : '';
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  let body: unknown = method === 'GET' ? {} : raw;
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
    { method, body, query, headers },
    { body: raw, signature: req.headers.get('stripe-signature'), header: (name) => req.headers.get(name), ip: clientIp(req) },
  );
  if (!res.ok) {
    if (res.error === 'rate_limited') return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    if (res.error === 'invalid_signature') return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    if (res.error === 'method_not_allowed') return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
    if (res.error === 'invalid_form') return NextResponse.json({ error: 'invalid_form', fields: res.fields ?? {} }, { status: 400 });
    if (res.error === 'form_check') return NextResponse.json({ error: 'form_check' }, { status: 400 });
    if (res.error === 'unauthorized') {
      // Cuenta como intento fallido de la IP: frena a quien prueba contraseñas.
      if (limits) await rateLimit(missKey, MISSES_PER_IP, 60);
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401, headers: res.basic ? { 'www-authenticate': 'Basic realm="flow", charset="UTF-8"' } : undefined },
      );
    }
    // Flow apagado o token inexistente: misma respuesta (no revela cuál).
    if (limits) await rateLimit(missKey, MISSES_PER_IP, 60);
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (res.ignored) return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  if (res.respond === 'reply_node' && res.runId) return replyFromRun(res.runId);
  return NextResponse.json({ ok: true, runId: res.runId }, { status: 202 });
}

/** Ejecuta la corrida (ya tomada) y responde con lo que armó el nodo "Responder al webhook". */
async function replyFromRun(runId: string): Promise<NextResponse> {
  const exec = executeRun(runId).catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[flow] webhook run failed', err);
    return 'failed' as const;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), REPLY_WAIT_MS);
  });
  const status = await Promise.race([exec, timeout]);
  clearTimeout(timer);
  if (status === 'timeout') {
    // La corrida sigue después de responder.
    after(() => exec);
    return NextResponse.json({ ok: true, runId }, { status: 202 });
  }
  const reply = await webhookReply(runId);
  if (!reply) {
    if (status === 'failed') return NextResponse.json({ ok: false, error: 'flow_failed', runId }, { status: 500 });
    return NextResponse.json({ ok: true, runId }, { status: status === 'success' ? 200 : 202 });
  }
  // El cuerpo lo arma el flow (datos de afuera): sin scripts ni acceso al origen.
  return new NextResponse(reply.body, {
    status: reply.status,
    headers: {
      ...reply.headers,
      'content-type': reply.contentType,
      'content-security-policy': 'sandbox',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  return handle(req, props, 'POST');
}

export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  return handle(req, props, 'GET');
}
