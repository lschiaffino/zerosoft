import { after, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  chatAttachmentType,
  cleanVisitorIdentity,
  createChatConversation,
  createChatMessage,
  getChatWidget,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  toPublicMessage,
  toPublicVisitor,
  updateChatConversation,
} from '@/lib/chat-data';
import { CHAT_MESSAGE_MAX } from '@/lib/chat-schema';
import { MAX_UPLOAD_SIZE, isAllowedUpload, saveUpload, UploadError } from '@/lib/uploads';
import { afterVisitorMessage } from '@/lib/chat-visitor-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-upload', 10, 600);
  if (limited) return limited;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const widgetId = typeof form.get('widgetId') === 'string' ? (form.get('widgetId') as string) : '';
  const visitorExternalId =
    typeof form.get('visitorId') === 'string' ? (form.get('visitorId') as string) : '';
  const file = form.get('file');

  if (!widgetId || !visitorExternalId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const widget = await getChatWidget(widgetId);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  const filename = (file as File).name || 'upload';
  const mime = file.type || 'application/octet-stream';
  if (!isAllowedUpload(filename, mime)) {
    return NextResponse.json({ error: 'file_type_not_allowed' }, { status: 415 });
  }

  const visitor = await getOrCreateChatVisitor(
    widgetId,
    visitorExternalId,
    cleanVisitorIdentity(form.get('email'), form.get('name')),
  );

  let conversation = (await getVisitorConversationWithMessages(widgetId, visitorExternalId))
    ?.conversation ?? null;
  let isNewConversation = false;
  if (!conversation) {
    conversation = await createChatConversation(widgetId, visitor.id);
    isNewConversation = true;
  }

  // Un mensaje del visitante despierta una conversación snoozed.
  if (conversation.status === 'snoozed') {
    conversation = (await updateChatConversation(conversation.id, { status: 'open' })) ?? conversation;
  }

  const caption =
    typeof form.get('body') === 'string' ? (form.get('body') as string).trim().slice(0, CHAT_MESSAGE_MAX) : '';
  const buffer = Buffer.from(await file.arrayBuffer());
  let url: string;
  try {
    url = await saveUpload('chat', filename, mime, buffer);
  } catch (err) {
    if (err instanceof UploadError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }

  const message = await createChatMessage(conversation.id, 'visitor', {
    body: caption,
    attachments: [
      {
        name: filename,
        url,
        size: file.size,
        mime,
        type: chatAttachmentType(mime),
      },
    ],
  });

  // Eventos, reglas de asignación, bot y notificaciones: igual que un mensaje de texto.
  const result = await afterVisitorMessage({
    widget,
    conversation,
    visitor,
    message,
    isNewConversation,
    text: caption || filename,
    schedule: after,
  });

  return NextResponse.json(
    {
      message: toPublicMessage(message),
      conversation: result.conversation,
      visitor: toPublicVisitor(visitor),
      bot: result.botMessage ? toPublicMessage(result.botMessage) : null,
    },
    { status: 201 },
  );
}
