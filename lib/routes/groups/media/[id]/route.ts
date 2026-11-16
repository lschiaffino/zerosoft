import { NextResponse } from 'next/server';
import { getChatRow, getMessageRow, getNumberRow, mediaRefFor, readConfig, retryInboundMedia, storeInboundMedia } from '@/lib/groups';
import { fetchCloudMedia } from '@/lib/groups-provider-cloud';
import type { BridgeConfig, CloudConfig } from '@/lib/groups-provider';
import { safeFetch } from '@/lib/safe-fetch';
import { mediaErrorKind } from '@/lib/wa-media-wire';
import { linkHqBytes, type StoredLink } from '@/lib/wa-link-thumb';
import { chatGuard, groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Media de un mensaje recibido. Meta y WAHA la sirven con credenciales: la
 * bajamos del lado del servidor y la pasamos al navegador (las credenciales
 * nunca salen). Solo para miembros del workspace.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const msg = await getMessageRow(s.ws, (await ctx.params).id);
  // ?link=1: la imagen grande de la vista previa del link que mandó WhatsApp (guardada al llegar el mensaje).
  if (msg && new URL(_req.url).searchParams.get('link') === '1') {
    const guard = await chatGuard(s, msg.chat_id);
    if (guard instanceof NextResponse) return guard;
    let link: StoredLink | undefined;
    try {
      link = (JSON.parse(msg.meta || '{}') as { link?: StoredLink }).link;
    } catch {
      link = undefined;
    }
    const img = linkHqBytes(link);
    if (!img) return groupsError(404, 'not_found');
    return new NextResponse(new Uint8Array(img.bytes), {
      headers: { 'content-type': img.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
    });
  }
  if (!msg?.media_url) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, msg.chat_id);
  if (guard instanceof NextResponse) return guard;
  const chat = await getChatRow(s.ws, msg.chat_id);
  const number = chat ? await getNumberRow(s.ws, chat.number_id) : null;
  if (!number) return groupsError(404, 'not_found');
  // Evolution: el archivo no se pudo guardar al llegar. Se baja ahora, se guarda y se redirige ahí.
  if (msg.media_url.startsWith('evo:') && (number.provider === 'evolution' || number.provider === 'managed' || number.provider === 'fake') && chat) {
    try {
      const ref = mediaRefFor(msg, chat.provider_chat_id) ?? { providerMessageId: msg.media_url.slice(4), chatId: chat.provider_chat_id, fromMe: msg.direction === 'out' };
      const stored = await storeInboundMedia(number, msg.id, { ...ref, providerMessageId: msg.media_url.slice(4) });
      // Otro pedido pudo guardarlo recién: se usa lo que quedó.
      const saved = stored?.url ?? (await getMessageRow(s.ws, msg.id))?.media_url ?? '';
      if (!saved || saved.startsWith('evo:')) return groupsError(404, 'not_found');
      return NextResponse.redirect(new URL(saved, _req.url), 302);
    } catch (err) {
      // Si quedó marcado como definitivo, la próxima vez ya no se pide. 410: WhatsApp ya no lo tiene.
      return mediaErrorKind(err) === 'gone' ? groupsError(410, 'media_gone') : groupsError(502, 'provider_error');
    }
  }
  let upstream: Response;
  try {
    if (msg.media_url.startsWith('meta:') && number.provider === 'cloud') {
      upstream = await fetchCloudMedia(readConfig(number) as CloudConfig, msg.media_url.slice(5));
    } else if (msg.media_url.startsWith('bridge:') && number.provider === 'waha') {
      const cfg = readConfig(number) as BridgeConfig;
      const url = msg.media_url.slice(7);
      // Solo del mismo gateway: la key no viaja a otro host.
      if (new URL(url).origin !== new URL(cfg.baseUrl).origin) return groupsError(404, 'not_found');
      upstream = await safeFetch(url, { headers: { 'x-api-key': cfg.apiKey } }, 15_000);
      if (!upstream.ok) return groupsError(502, 'provider_error');
    } else return groupsError(404, 'not_found');
  } catch {
    return groupsError(502, 'provider_error');
  }
  const type = upstream.headers.get('content-type') || msg.media_type || 'application/octet-stream';
  // Nada que el navegador pueda ejecutar en nuestro origen.
  const safeType = /(html|svg|xml|javascript)/i.test(type) ? 'application/octet-stream' : type;
  return new NextResponse(upstream.body, {
    headers: {
      'content-type': safeType,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename="${(msg.media_name || 'file').replace(/[^\w.-]/g, '_')}"`,
    },
  });
}

/**
 * "Bajar de nuevo" un archivo recibido que no está (Evolution): lo vuelve a
 * pedir; con la clave del archivo, el gateway lo baja de WhatsApp o le pide al
 * teléfono que lo vuelva a subir. Responde la URL nueva, o si ya no está.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const msg = await getMessageRow(s.ws, (await ctx.params).id);
  if (!msg?.media_type) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, msg.chat_id);
  if (guard instanceof NextResponse) return guard;
  const chat = await getChatRow(s.ws, msg.chat_id);
  const number = chat ? await getNumberRow(s.ws, chat.number_id) : null;
  if (!chat || !number || number.provider === 'cloud' || number.provider === 'waha') return groupsError(404, 'not_found');
  const r = await retryInboundMedia(number, msg, chat.provider_chat_id);
  if ('url' in r) return NextResponse.json({ url: r.url });
  if ('gone' in r) return NextResponse.json({ gone: true }, { status: 410 });
  return NextResponse.json({ pending: true }, { status: 503 });
}
