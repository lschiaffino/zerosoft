import { NextResponse } from 'next/server';
import { getChatRow, getMessageRow, getNumberRow, readConfig } from '@/lib/groups';
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
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const msg = await getMessageRow(s.ws, (await ctx.params).id);
  if (!msg?.media_url) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, msg.chat_id);
  if (guard instanceof NextResponse) return guard;
  const chat = await getChatRow(s.ws, msg.chat_id);
  const number = chat ? await getNumberRow(s.ws, chat.number_id) : null;
  if (!number) return groupsError(404, 'not_found');
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
