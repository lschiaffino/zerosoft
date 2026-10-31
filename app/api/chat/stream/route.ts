import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import { chatStream, visitorConversationFilter } from '@/lib/chat-realtime';
import { getChatVisitorByExternalId, getChatWidget } from '@/lib/chat-data';
import { cleanPublicVisitorKey } from '@/lib/chat-visitor-key';
import { limitByIp } from '@/lib/rate-limit';
import { requestCursor } from '@/lib/realtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 250;

const busy = () => NextResponse.json({ error: 'too_many_streams' }, { status: 429 });

/**
 * Aviso SSE de qué conversación cambió: solo ids, el cliente relee por las
 * rutas con su acceso.
 *  - sin parámetros: las bandejas que ve la persona (equipo).
 *  - ?widgetId=&visitorId=: el visitante en el widget (público, como el GET de mensajes).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cursor = requestCursor(req);
  const widgetId = url.searchParams.get('widgetId');
  if (widgetId) {
    const limited = await limitByIp(req, 'chat-stream', 60, 60);
    if (limited) return limited;
    const key = cleanPublicVisitorKey(url.searchParams.get('visitorId'));
    const widget = await getChatWidget(widgetId.slice(0, 64));
    if (!key || !widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // Un visitante que todavía no escribió no tiene nada que escuchar.
    const visitor = await getChatVisitorByExternalId(widget.id, key);
    if (!visitor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const res = chatStream({
      key: `v:${widget.id}:${visitor.id}`,
      cursor,
      signal: req.signal,
      headers: { 'Access-Control-Allow-Origin': '*' },
      allowed: visitorConversationFilter(widget.id, visitor.id),
      check: async () => true,
    });
    return res ?? busy();
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await limitByIp(req, 'chat-stream-team', 60, 60);
  if (limited) return limited;
  let widgets = new Set((await listAccessibleChatWidgets(user)).map((w) => w.id));
  const res = chatStream({
    key: `u:${realUserId(user)}`,
    cursor,
    signal: req.signal,
    allowed: (e) => widgets.has(e.widget_id),
    check: async () => {
      // Si le sacaron una bandeja, deja de avisar en la próxima vuelta.
      const fresh = await getCurrentUser();
      if (!fresh) return false;
      widgets = new Set((await listAccessibleChatWidgets(fresh)).map((w) => w.id));
      return true;
    },
  });
  return res ?? busy();
}
