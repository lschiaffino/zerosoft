import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  getChatConversationWithVisitor,
  getChatWidget,
  isChatAgentOfWidget,
  updateChatConversation,
} from '@/lib/chat-data';
import { conversationPatchSchema } from '@/lib/chat-schema';
import { applyAttributePatch, parseAttributeDefs, parseAttributeValues } from '@/lib/chat-attributes';
import { attributesBlockingResolve, saveConversationAttributes } from '@/lib/chat-attributes-db';
import { teamBelongsTo } from '@/lib/chat-collab';
import { ingestChatConversation, runAfterResponse, supportWidgetId } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';


export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Con visitante y agente asignado (el inbox la refresca con este GET).
  return NextResponse.json((await getChatConversationWithVisitor(params.id)) ?? conversation);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation: before } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = conversationPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // Solo se asigna a agentes del widget (si no, se filtran datos de usuarios
  // ajenos vía el JOIN de la respuesta y la conversación queda huérfana).
  const widget = before ? await getChatWidget(before.widget_id) : undefined;
  if (parsed.data.assignedTo && before) {
    if (!widget || !(await isChatAgentOfWidget(widget, parsed.data.assignedTo))) {
      return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
    }
  }

  if (parsed.data.teamId && (!widget || !(await teamBelongsTo(widget.user_id, parsed.data.teamId)))) {
    return NextResponse.json({ error: 'invalid_team' }, { status: 400 });
  }

  // Atributos primero: el mismo PATCH puede completarlos y resolver.
  let attributes = before?.attributes;
  if (parsed.data.attributes && before) {
    const result = applyAttributePatch(
      parseAttributeDefs(widget?.conversation_attributes),
      parseAttributeValues(before.attributes),
      parsed.data.attributes,
    );
    if (!result.ok) return NextResponse.json({ error: result.error, attributeId: result.attributeId }, { status: 400 });
    attributes = JSON.stringify(result.values);
    await saveConversationAttributes(params.id, result.values);
  }

  // Resolver pide los atributos obligatorios del widget completos.
  if (parsed.data.status === 'resolved' && before && before.status !== 'resolved') {
    const missing = await attributesBlockingResolve({ widget_id: before.widget_id, attributes }, widget);
    if (missing.length > 0) return NextResponse.json({ error: 'missing_attributes', missing }, { status: 400 });
  }

  const { attributes: _attributes, ...patch } = parsed.data;
  void _attributes;
  const updated = await updateChatConversation(params.id, patch);
  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });

  // Conversación de soporte propio resuelta → señal para el roadmap.
  if (
    updated.status === 'resolved' &&
    before?.status !== 'resolved' &&
    supportWidgetId() &&
    updated.widget_id === supportWidgetId()
  ) {
    await runAfterResponse(() => ingestChatConversation(updated.id));
  }

  const withVisitor = await getChatConversationWithVisitor(params.id);
  return NextResponse.json(withVisitor ?? updated);
}
