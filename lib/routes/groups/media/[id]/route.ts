import { NextRequest, NextResponse } from 'next/server';
import { isFileUrl } from '@/lib/files/store';
import { ownedFileResponse } from '@/lib/files/serve';
import { proxyPublicBlob } from '@/lib/files/legacy-proxy';
import { localResponse } from '@/lib/crm-media-file';
import { servingFor } from '@/lib/file-attachments';
import { localUploadPath } from '@/lib/uploads';
import { getChatRow, getMessageRow, getNumberRow, mediaRefFor, readConfig, retryInboundMedia, storeInboundMedia } from '@/lib/groups';
import { fetchCloudMedia } from '@/lib/groups-provider-cloud';
import type { BridgeConfig, CloudConfig } from '@/lib/groups-provider';
import { safeFetch } from '@/lib/safe-fetch';
import { getDb } from '@/lib/db';
import { isPdf, validDocThumb, validPages } from '@/lib/wa-doc-thumb';
import { fetchStateOf, mediaErrorKind } from '@/lib/wa-media-wire';
import { linkHqBytes, type StoredLink } from '@/lib/wa-link-thumb';
import { chatGuard, groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Media de un mensaje recibido. Meta y WAHA la sirven con credenciales: la
 * bajamos del lado del servidor y la pasamos al navegador (las credenciales
 * nunca salen). Solo para miembros del workspace.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const msg = await getMessageRow(s.ws, (await ctx.params).id);
  // ?link=1: la imagen grande de la vista previa del link que mandó WhatsApp (guardada al llegar el mensaje).
  if (msg && new URL(req.url).searchParams.get('link') === '1') {
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
  // Evolution: el archivo no se pudo guardar al llegar. Se baja ahora, se guarda (privado) y se sirve desde acá.
  let stored = msg.media_url;
  if (stored.startsWith('evo:') && (number.provider === 'evolution' || number.provider === 'managed' || number.provider === 'fake') && chat) {
    const ref = mediaRefFor(msg, chat.provider_chat_id) ?? { providerMessageId: stored.slice(4), chatId: chat.provider_chat_id, fromMe: msg.direction === 'out' };
    try {
      const saved = await storeInboundMedia(number, msg.id, { ...ref, providerMessageId: stored.slice(4) });
      // Otro pedido pudo guardarlo recién: se usa lo que quedó.
      stored = saved?.url ?? (await getMessageRow(s.ws, msg.id))?.media_url ?? '';
      if (!stored || stored.startsWith('evo:')) return groupsError(404, 'not_found');
    } catch (err) {
      // Si quedó marcado como definitivo, la próxima vez ya no se pide. 410: WhatsApp ya no lo tiene.
      const state = number.status !== 'connected' ? 'offline' : fetchStateOf(mediaErrorKind(err, !!ref.wire));
      return state === 'gone' ? groupsError(410, 'media_gone') : state === 'offline' ? groupsError(409, 'not_connected') : groupsError(502, 'provider_error');
    }
  }
  // Lo mandado antes se guardaba absoluto (origen propio + /uploads/…): se sirve igual que el relativo.
  stored = ownUploadPath(stored, req) ?? stored;
  const download = new URL(req.url).searchParams.get('download') === '1';
  // Guardado por nosotros (storage privado): solo si el archivo es de este workspace.
  if (isFileUrl(stored)) return (await ownedFileResponse(req, stored, { workspaceId: s.ws }, { download })) ?? groupsError(404, 'not_found');
  // De antes: Blob público o disco local. Se pasa por acá (la URL del storage no llega al navegador).
  // Como /api/files: en línea solo lo previsualizable (con su tipo de la lista), lo demás se descarga; siempre aislado.
  const safeHeaders = { ...servingFor(msg.media_name || '', msg.media_type, { download }).headers, 'Cache-Control': 'private, max-age=3600' };
  if (/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(stored)) return proxyPublicBlob(req, stored, safeHeaders);
  if (stored.startsWith('/uploads/')) {
    const file = localUploadPath(stored, 'chat');
    if (!file) return groupsError(404, 'not_found');
    return localResponse(req as NextRequest, file, safeHeaders);
  }
  let upstream: Response;
  try {
    if (stored.startsWith('meta:') && number.provider === 'cloud') {
      upstream = await fetchCloudMedia(readConfig(number) as CloudConfig, stored.slice(5));
    } else if (stored.startsWith('bridge:') && number.provider === 'waha') {
      const cfg = readConfig(number) as BridgeConfig;
      const url = stored.slice(7);
      // Solo del mismo gateway: la key no viaja a otro host.
      if (new URL(url).origin !== new URL(cfg.baseUrl).origin) return groupsError(404, 'not_found');
      upstream = await safeFetch(url, { headers: { 'x-api-key': cfg.apiKey } }, 15_000);
      if (!upstream.ok) return groupsError(502, 'provider_error');
    } else return groupsError(404, 'not_found');
  } catch {
    return groupsError(502, 'provider_error');
  }
  const type = msg.media_type || upstream.headers.get('content-type') || 'application/octet-stream';
  // Nada que el navegador pueda ejecutar en nuestro origen: lo que no se muestra en línea se descarga.
  return new NextResponse(upstream.body, {
    headers: { ...servingFor(msg.media_name || '', type, { download }).headers, 'Cache-Control': 'private, max-age=3600' },
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
  if ('offline' in r) return NextResponse.json({ offline: true }, { status: 409 });
  return NextResponse.json({ pending: true }, { status: 503 });
}

/**
 * Guarda la vista previa de la primera página de un PDF (la dibujó el
 * navegador de quien lo vio primero): un JPEG chico validado por sus bytes,
 * solo en un PDF que todavía no tiene. Después llega con el mensaje.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const msg = await getMessageRow(s.ws, (await ctx.params).id);
  if (!msg) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, msg.chat_id);
  if (guard instanceof NextResponse) return guard;
  const body = (await req.json().catch(() => null)) as { thumb?: unknown; pages?: unknown } | null;
  const thumb = validDocThumb(body?.thumb);
  if (!thumb || !isPdf(msg.media_type, msg.media_name)) return groupsError(400, 'invalid_input');
  let meta: { media?: Record<string, unknown> } & Record<string, unknown> = {};
  try {
    meta = JSON.parse(msg.meta || '{}') as typeof meta;
  } catch {
    meta = {};
  }
  if (!meta.media?.thumbnail) {
    const pages = validPages(body?.pages);
    const media = { kind: 'document', ...(meta.media ?? {}), thumbnail: thumb, ...(pages && !meta.media?.pages ? { pages } : {}) };
    await getDb().prepare('UPDATE groups_messages SET meta = ? WHERE id = ? AND user_id = ?').run(JSON.stringify({ ...meta, media }), msg.id, s.ws);
  }
  return NextResponse.json({ ok: true });
}

/** /uploads/… de una URL absoluta de nuestro origen (NEXTAUTH_URL o el del pedido); null si no lo es. */
function ownUploadPath(url: string, req: Request): string | null {
  if (!/^https?:\/\//.test(url)) return null;
  try {
    const u = new URL(url);
    const own = [process.env.NEXTAUTH_URL, new URL(req.url).origin].flatMap((o) => {
      try {
        return o ? [new URL(o).host.toLowerCase()] : [];
      } catch {
        return [];
      }
    });
    return own.includes(u.host.toLowerCase()) && u.pathname.startsWith('/uploads/') && !u.search ? u.pathname : null;
  } catch {
    return null;
  }
}
