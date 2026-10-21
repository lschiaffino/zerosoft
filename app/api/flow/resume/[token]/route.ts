import { NextRequest, NextResponse } from 'next/server';
import { RESUME_BODY_LIMIT, resumeFromCall } from '@/lib/flow-waits';
import { clientIp, isRateLimited, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Intentos fallidos por IP (token inválido o corrida que ya no espera). */
const MISSES_PER_IP = 60;

/**
 * {{run.resumeUrl}}: retoma el Esperar (modo "hasta una llamada") de una
 * corrida. Público: la URL está firmada por corrida. GET o POST; el body
 * (JSON, formulario o texto) y la query quedan como salida del nodo. El
 * resto del flow corre después de responder.
 */
async function handle(req: NextRequest, props: { params: Promise<{ token: string }> }, method: 'GET' | 'POST') {
  const { token } = await props.params;
  const limits = process.env.RATE_LIMIT_DISABLED !== 'true';
  const missKey = `flow-resume-miss:${clientIp(req)}`;
  if (limits && (await isRateLimited(missKey, MISSES_PER_IP, 60))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const raw = method === 'POST' ? await req.text().catch(() => '') : '';
  if (raw.length > RESUME_BODY_LIMIT) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
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
  const query = Object.fromEntries(req.nextUrl.searchParams);
  const res = await resumeFromCall(token, { method, body, query }, { background: true });
  if (!res.ok) {
    if (res.error === 'busy') return NextResponse.json({ error: 'busy' }, { status: 409, headers: { 'retry-after': '5' } });
    if (limits) await rateLimit(missKey, MISSES_PER_IP, 60);
    // Token inválido o corrida que ya siguió (o venció): no se distingue.
    return NextResponse.json({ error: res.error === 'not_found' ? 'not_found' : 'not_waiting' }, { status: res.error === 'not_found' ? 404 : 410 });
  }
  return NextResponse.json({ ok: true, runId: res.runId }, { status: 202 });
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  return handle(req, props, 'POST');
}

export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  return handle(req, props, 'GET');
}
