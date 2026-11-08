import { NextResponse } from 'next/server';
import { getAccountById } from '@/lib/inbox/core';
import { ingestWhatsappEvents, waProviderFor } from '@/lib/inbox/whatsapp';
import { safeEqual } from '@/lib/groups-provider';
import { limitByIp } from '@/lib/rate-limit';
import { readTextCapped } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; secret: string }> };

const MAX_BODY = 2 * 1024 * 1024;

/**
 * Eventos del servidor de WhatsApp para una cuenta personal. Valida el
 * secreto de la URL (mismo 404 si la cuenta no existe o el secreto no
 * coincide) y que el cuerpo venga de la instancia de esa cuenta.
 */
export async function POST(req: Request, ctx: Ctx) {
  const limited = await limitByIp(req, 'inbox-webhook', 600, 60).catch(() => null);
  if (limited) return limited;
  const { id, secret } = await ctx.params;
  const account = await getAccountById(id);
  if (!account || account.kind !== 'whatsapp' || !account.webhook_secret || !safeEqual(secret, account.webhook_secret)) {
    return new NextResponse('not found', { status: 404 });
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return new NextResponse('too large', { status: 413 });
  const raw = await readTextCapped(new Response(req.body), MAX_BODY + 1);
  if (Buffer.byteLength(raw) > MAX_BODY) return new NextResponse('too large', { status: 413 });
  let provider;
  try {
    provider = waProviderFor(account);
  } catch {
    return new NextResponse('unavailable', { status: 503 });
  }
  if (!provider.verifyWebhook({ headers: req.headers, rawBody: raw }, account.webhook_secret)) {
    return new NextResponse('invalid signature', { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse('invalid json', { status: 400 });
  }
  // Historial que WhatsApp manda al vincular (MESSAGES_SET): sin avisos ni no leídos.
  const history = /^messages[._]set$/i.test(String((body as { event?: unknown } | null)?.event ?? ''));
  const result = await ingestWhatsappEvents(account, provider.parseWebhook(body), { history });
  return NextResponse.json({ ok: true, ...result });
}
