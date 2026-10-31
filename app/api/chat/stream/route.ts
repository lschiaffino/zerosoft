import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation, listAccessibleChatWidgets } from '@/lib/chat-access';
import { conversationFingerprint, fingerprintStream, inboxFingerprint, visitorFingerprint } from '@/lib/chat-realtime';
import { getChatVisitorByExternalId, getChatWidget } from '@/lib/chat-data';
import { cleanPublicVisitorKey } from '@/lib/chat-visitor-key';
import { limitByIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 130;

/**
 * Aviso SSE de que algo cambió. Sin contenido: el cliente relee por las rutas
 * con su acceso.
 *  - ?conversation=<id>: una conversación (equipo).
 *  - sin parámetros: la bandeja (equipo).
 *  - ?widgetId=&visitorId=: el visitante en el widget (público, como el GET de mensajes).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const widgetId = url.searchParams.get('widgetId');
  if (widgetId) {
    const limited = await limitByIp(req, 'chat-stream', 60, 60);
    if (limited) return limited;
    const visitorId = cleanPublicVisitorKey(url.searchParams.get('visitorId'));
    const widget = await getChatWidget(widgetId.slice(0, 64));
    if (!visitorId || !widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // Un visitante que todavía no escribió no tiene nada que escuchar.
    if (!(await getChatVisitorByExternalId(widget.id, visitorId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return fingerprintStream(() => visitorFingerprint(widget.id, visitorId), {
      intervalMs: 1500,
      signal: req.signal,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const conversationId = url.searchParams.get('conversation');
  if (conversationId) {
    const access = await canAccessConversation(conversationId.slice(0, 64), user);
    if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return fingerprintStream(() => conversationFingerprint(access.conversation!.id), { intervalMs: 1000, signal: req.signal });
  }
  const widgetIds = (await listAccessibleChatWidgets(user)).map((w) => w.id);
  return fingerprintStream(() => inboxFingerprint(widgetIds), { intervalMs: 2000, signal: req.signal });
}
