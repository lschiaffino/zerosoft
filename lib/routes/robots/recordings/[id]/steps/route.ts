import { NextRequest, NextResponse } from 'next/server';
import { pushRobotRecording } from '@/lib/robots';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600',
};

/** Tope del cuerpo: 100 pasos con sus alternativos entran de sobra. */
const MAX_BODY = 512 * 1024;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * El grabador manda los pasos desde el sitio que se está grabando: otro origen
 * y sin sesión. Vale el token de la grabación, que solo escribe acá; a los pasos
 * del robot pasan cuando la persona los agrega desde el editor.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const reply = (status: number, body: unknown) => NextResponse.json(body, { status, headers: CORS });
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const rl = await rateLimit(`robot-recording:${id}`, 1200, 3600);
    if (!rl.ok) return reply(429, { error: 'rate_limited' });
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return reply(413, { error: 'too_large' });
  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY) return reply(413, { error: 'too_large' });
  let data: { token?: unknown; steps?: unknown } | null = null;
  try {
    data = JSON.parse(text) as { token?: unknown; steps?: unknown };
  } catch {
    return reply(400, { error: 'invalid_json' });
  }
  if (typeof data?.token !== 'string') return reply(404, { error: 'not_found' });
  const res = await pushRobotRecording(id, data.token, data.steps);
  if (!res.ok) return reply(res.error === 'not_found' ? 404 : 400, { error: res.error });
  return reply(200, { count: res.count });
}
