/**
 * Webhook de WhatsApp de una cuenta personal de Inbox. Lo usan las dos rutas:
 * la nueva (/api/inbox/webhook/{id}, secreto en el header) y la vieja
 * (/api/inbox/webhook/{id}/{secreto}), que se acepta mientras haya instancias
 * registradas con ella (lib/wa-webhook-secret.ts). Server-only.
 */
import { NextResponse } from 'next/server';
import { getAccountById } from './core';
import { ingestHistoryChats, ingestWhatsappEvents, scheduleWhatsappBackfill, waProviderFor } from './whatsapp';
import { safeEqual } from '../groups-provider';
import { limitByIp } from '../rate-limit';
import { readTextCapped } from '../safe-fetch';

// Las tandas del historial (al vincular) pasan de 2 MB: con ese tope el gateway recibía 413 y, tras sus reintentos,
// las descartaba. 4 MB entra en el límite del cuerpo de una función.
const MAX_BODY = 4 * 1024 * 1024;

/**
 * Valida el secreto (mismo 404 si la cuenta no existe, falta el secreto o no
 * coincide) y que el cuerpo venga de la instancia de esa cuenta.
 */
export async function handleInboxWebhook(req: Request, id: string, secret: string): Promise<NextResponse> {
  // El límite por IP y la fila de la cuenta, a la vez: son dos idas a la base que no dependen una de la otra.
  const [limited, account] = await Promise.all([limitByIp(req, 'inbox-webhook', 600, 60).catch(() => null), getAccountById(id)]);
  if (limited) return limited;
  if (!secret || !account || account.kind !== 'whatsapp' || !account.webhook_secret || !safeEqual(secret, account.webhook_secret)) {
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
  // Evolution manda el evento como "messages.set" o "MESSAGES_SET" según la versión.
  const event = String((body as { event?: unknown } | null)?.event ?? '').toLowerCase().replace(/_/g, '.');
  // Historial que WhatsApp manda al vincular (MESSAGES_SET): sin avisos ni no leídos.
  const history = event === 'messages.set';
  // CHATS_SET: los chats del historial entran a la lista aunque no tengan mensajes todavía.
  const chats = event === 'chats.set' ? await ingestHistoryChats(account, (body as { data?: unknown }).data) : 0;
  const result = await ingestWhatsappEvents(account, provider.parseWebhook(body), { history });
  // Llegó una tanda del historial: la importación desde el servidor corre cuando termine de llegar.
  if (history || event === 'chats.set') await scheduleWhatsappBackfill(account.id).catch(() => null);
  // Un mensaje que no se pudo guardar: 500 para que el servidor de WhatsApp lo reintente (lo ya guardado no se duplica).
  if (result.failed) return NextResponse.json({ ok: false, chats, ...result }, { status: 500 });
  return NextResponse.json({ ok: true, chats, ...result });
}
