import { NextRequest, NextResponse } from 'next/server';
import { isFileUrl } from '@/lib/files/store';
import { ownedFileResponse } from '@/lib/files/serve';
import { proxyPublicBlob } from '@/lib/files/legacy-proxy';
import { localResponse } from '@/lib/crm-media-file';
import { servingFor } from '@/lib/file-attachments';
import { localUploadPath } from '@/lib/uploads';
import { getChatRow, getMessageRow, getNumberRow, readConfig, storeInboundMedia } from '@/lib/groups';
import { fetchCloudMedia } from '@/lib/groups-provider-cloud';
import type { BridgeConfig, CloudConfig } from '@/lib/groups-provider';
import { safeFetch } from '@/lib/safe-fetch';
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
  if (!msg?.media_url) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, msg.chat_id);
  if (guard instanceof NextResponse) return guard;
  const chat = await getChatRow(s.ws, msg.chat_id);
  const number = chat ? await getNumberRow(s.ws, chat.number_id) : null;
  if (!number) return groupsError(404, 'not_found');
  // Evolution: el archivo no se pudo guardar al llegar. Se baja ahora y se guarda.
  let stored = msg.media_url;
  if (stored.startsWith('evo:') && (number.provider === 'evolution' || number.provider === 'managed') && chat) {
    try {
      const saved = await storeInboundMedia(number, msg.id, {
        providerMessageId: stored.slice(4),
        chatId: chat.provider_chat_id,
        fromMe: msg.direction === 'out',
      });
      // Otro pedido pudo guardarlo recién: se usa lo que quedó.
      stored = saved?.url ?? (await getMessageRow(s.ws, msg.id))?.media_url ?? '';
      if (!stored || stored.startsWith('evo:')) return groupsError(404, 'not_found');
    } catch {
      // Si quedó marcado como definitivo, la próxima vez ya no se pide.
      return groupsError(502, 'provider_error');
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
