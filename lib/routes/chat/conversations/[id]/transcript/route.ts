import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { getChatConversationWithVisitor, getChatWidget, listChatMessagesWithUsers } from '@/lib/chat-data';
import {
  emailTranscriptToVisitor,
  transcriptEntries,
  transcriptFilename,
  transcriptJson,
  transcriptStrings,
  transcriptText,
} from '@/lib/chat-transcript';
import { requestLocale } from '@/lib/request-locale';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Descarga del transcript para el equipo: ?format=txt (default) | json y
 * ?notes=1 para sumar las notas internas. Los mensajes borrados no salen.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(id, user);
  const conversation = ok ? await getChatConversationWithVisitor(id) : undefined;
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'txt';
  const includeNotes = url.searchParams.get('notes') === '1';
  const cookie = req.headers.get('cookie')?.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1] ?? null;
  const locale = requestLocale(cookie, req.headers.get('accept-language'));
  const s = transcriptStrings(locale);
  const visitorName = conversation.visitor.name || conversation.visitor.email || s.visitor;
  const entries = transcriptEntries(await listChatMessagesWithUsers(id), {
    audience: 'team',
    includeNotes,
    visitorName,
    teamName: conversation.widget_name,
    strings: s,
  });
  const body =
    format === 'json'
      ? transcriptJson(conversation, entries)
      : transcriptText({ widgetName: conversation.widget_name, visitorName, startedAt: conversation.created_at }, entries, locale);
  return new Response(body, {
    headers: {
      'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${transcriptFilename(conversation.widget_name, conversation.created_at, format)}"`,
      'cache-control': 'no-store',
    },
  });
}

/**
 * Manda el transcript al email del visitante (sin notas, borrados ni
 * mensajes de sistema). Tope: 5 por conversación por hora.
 */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(id, user);
  const conversation = ok ? await getChatConversationWithVisitor(id) : undefined;
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!conversation.visitor.email) return NextResponse.json({ error: 'no_visitor_email' }, { status: 400 });

  const limit = await rateLimit(`chat-transcript:${id}`, 5, 3600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const widget = await getChatWidget(conversation.widget_id);
  const result = await emailTranscriptToVisitor(conversation, await listChatMessagesWithUsers(id), widget?.locale);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'no_visitor_email' ? 400 : 502 });
  return NextResponse.json({ ok: true, to: result.to });
}
