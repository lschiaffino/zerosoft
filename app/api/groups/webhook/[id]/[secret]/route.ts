import { NextResponse } from 'next/server';
import { getNumberRowById, ingestEvents, providerFor, readConfig } from '@/lib/groups';
import { safeEqual } from '@/lib/groups-provider';
import { limitByIp } from '@/lib/rate-limit';
import { readTextCapped } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; secret: string }> };

const MAX_BODY = 2 * 1024 * 1024;

async function numberFor(ctx: Ctx) {
  const { id, secret } = await ctx.params;
  const row = await getNumberRowById(id);
  // Mismo 404 para número inexistente y secreto equivocado (no se puede enumerar).
  if (!row || !safeEqual(secret, row.webhook_secret)) return null;
  return row;
}

/** Verificación de Meta: GET con hub.mode=subscribe y el verify token del número. */
export async function GET(req: Request, ctx: Ctx) {
  const row = await numberFor(ctx);
  if (!row || row.provider !== 'cloud') return new NextResponse('not found', { status: 404 });
  const url = new URL(req.url);
  const token = url.searchParams.get('hub.verify_token') ?? '';
  const expected = readConfig(row).verifyToken ?? '';
  if (url.searchParams.get('hub.mode') !== 'subscribe' || !safeEqual(token, expected)) {
    return new NextResponse('forbidden', { status: 403 });
  }
  return new NextResponse(url.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
}

/**
 * Eventos del proveedor. Valida el secreto de la URL y la firma del
 * proveedor (Meta: X-Hub-Signature-256; WAHA: X-Webhook-Hmac si está), y
 * guarda los mensajes sin duplicar (índice único por id del proveedor).
 * Responde 200 aunque falle un evento que no es un mensaje (un estado, una
 * presencia); si lo que falló es guardar un mensaje, 500 para que el proveedor
 * lo reintente (lo ya guardado no se duplica).
 */
export async function POST(req: Request, ctx: Ctx) {
  // El límite por IP y la fila del número, a la vez: son dos idas a la base que no dependen una de la otra.
  const [limited, row] = await Promise.all([limitByIp(req, 'groups-webhook', 600, 60).catch(() => null), numberFor(ctx)]);
  if (limited) return limited;
  if (!row) return new NextResponse('not found', { status: 404 });
  // Tope antes de leer (content-length) y mientras se lee (un cuerpo sin largo declarado tampoco pasa).
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return new NextResponse('too large', { status: 413 });
  const raw = await readTextCapped(new Response(req.body), MAX_BODY + 1);
  if (Buffer.byteLength(raw) > MAX_BODY) return new NextResponse('too large', { status: 413 });
  let provider;
  try {
    provider = providerFor(row);
  } catch {
    return new NextResponse('unavailable', { status: 503 });
  }
  if (!provider.verifyWebhook({ headers: req.headers, rawBody: raw }, row.webhook_secret)) {
    return new NextResponse('invalid signature', { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse('invalid json', { status: 400 });
  }
  const events = provider.parseWebhook(body);
  // Historial que WhatsApp manda al vincular (Evolution MESSAGES_SET): se guarda sin avisos, reglas ni SLA.
  const history = /^messages[._]set$/i.test(String((body as { event?: unknown } | null)?.event ?? ''));
  const result = await ingestEvents(row, events, { history });
  // Un mensaje que no se pudo guardar (un error, no un repetido): 500 para que el proveedor reintente. Evolution
  // reintenta lo que no es 2xx hasta 10 veces con espera creciente (5 s a 5 min) y lo ya guardado no se duplica
  // (índice único por id del proveedor), así que el reintento solo recupera lo que faltó.
  if (result.failed) return NextResponse.json({ ok: false, ...result }, { status: 500 });
  return NextResponse.json({ ok: true, ...result });
}
