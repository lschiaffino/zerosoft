import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { createChatMessage, recordFirstResponse, reopenIfResolved } from '@/lib/chat-data';
import { CHAT_MESSAGE_MAX } from '@/lib/chat-schema';
import { getApiConversation } from '@/lib/chat-access';
import { toApiMessage } from '@/lib/chat-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  body: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
  /** true = nota interna (el visitante no la ve). */
  note: z.boolean().optional(),
});

/**
 * Responde en la conversación como la persona dueña de la key (como desde el
 * inbox: corre el SLA de primera respuesta y reabre si estaba resuelta).
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'chat:write');
  if ('res' in auth) return auth.res;
  const conversation = await getApiConversation(auth, id);
  if (!conversation) return apiError(404, 'not_found', 'Conversation not found.');
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', `"body" is required (1 to ${CHAT_MESSAGE_MAX} characters).`);
  const isNote = parsed.data.note === true;
  const message = await createChatMessage(id, 'user', { body: parsed.data.body, userId: auth.personId, isNote });
  if (!isNote) {
    await recordFirstResponse(id);
    await reopenIfResolved(conversation);
  }
  return NextResponse.json(toApiMessage(message), { status: 201 });
}
