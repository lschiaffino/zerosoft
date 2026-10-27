import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { getChatVisitor, getChatWidget } from '@/lib/chat-data';
import { AiError } from '@/lib/ai';
import { COPILOT_ACTIONS, CopilotError, runCopilot, type CopilotAction } from '@/lib/chat-copilot';
import { limitWrites } from '@/lib/write-limit';

export const dynamic = 'force-dynamic';

/**
 * AI del agente: { action: summarize | draft | rephrase | friendlier | shorter | translate, text?, lang?, locale? }.
 * Devuelve { text, sources }; nada se envía al visitante. Sin AI: 503 ai_disabled.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation } = await canAccessConversation(id, user);
  if (!ok || !conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const limited = await limitWrites('chat-copilot', realUserId(user), 30, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (!body || typeof action !== 'string' || !(COPILOT_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const widget = await getChatWidget(conversation.widget_id);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const visitor = await getChatVisitor(conversation.visitor_id);
  try {
    const result = await runCopilot({
      ws: widget.user_id,
      widget,
      conversationId: id,
      action: action as CopilotAction,
      text: typeof body.text === 'string' ? body.text : undefined,
      lang: typeof body.lang === 'string' ? body.lang.slice(0, 5) : undefined,
      locale: typeof body.locale === 'string' ? body.locale.slice(0, 5) : undefined,
      visitorMetadata: visitor?.metadata ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.code }, { status: err.code === 'ai_disabled' ? 503 : 429 });
    if (err instanceof CopilotError) return NextResponse.json({ error: err.code }, { status: 400 });
    // eslint-disable-next-line no-console
    console.error('[chat] copilot failed', (err as Error)?.name ?? 'error');
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
  }
}
