import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getChatWidget, isChatAgentOfWidget, updateChatConversation } from '@/lib/chat-data';
import { getApiConversation } from '@/lib/chat-access';
import { toApiConversation } from '@/lib/chat-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ assignedTo: z.string().trim().min(1).max(100).nullable() });

/** Asigna la conversación a un agente del widget (null = sin asignar). */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'chat:write');
  if ('res' in auth) return auth.res;
  const conversation = await getApiConversation(auth, id);
  if (!conversation) return apiError(404, 'not_found', 'Conversation not found.');
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', '"assignedTo" must be a user id or null.');
  const { assignedTo } = parsed.data;
  if (assignedTo) {
    const widget = await getChatWidget(conversation.widget_id);
    if (!widget || !(await isChatAgentOfWidget(widget, assignedTo))) {
      return apiError(400, 'invalid_assignee', 'That person is not an agent of this widget.');
    }
  }
  await updateChatConversation(id, { assignedTo });
  const after = await getApiConversation(auth, id);
  return NextResponse.json(toApiConversation(after!));
}
