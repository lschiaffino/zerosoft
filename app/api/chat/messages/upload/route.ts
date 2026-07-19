import { NextResponse } from 'next/server';
import {
  chatAttachmentType,
  createChatConversation,
  createChatMessage,
  getChatWidget,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  maybeRunChatBot,
  updateChatConversation,
} from '@/lib/chat-data';
import { saveChatFile } from '@/lib/chat-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: Request) {
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
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  const visitor = await getOrCreateChatVisitor(widgetId, visitorExternalId);

  let conversation = (await getVisitorConversationWithMessages(widgetId, visitorExternalId))
    ?.conversation ?? null;
  if (!conversation) {
    conversation = await createChatConversation(widgetId, visitor.id);
  }

  // Un mensaje del visitante despierta una conversación snoozed.
  if (conversation.status === 'snoozed') {
    conversation = (await updateChatConversation(conversation.id, { status: 'open' })) ?? conversation;
  }

  const caption = typeof form.get('body') === 'string' ? (form.get('body') as string).trim() : '';
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = (file as File).name || 'upload';
  const mime = file.type || 'application/octet-stream';
  const url = await saveChatFile(filename, buffer);

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

  // Bot: responde al primer mensaje si nadie contestó todavía.
  const botMessage = await maybeRunChatBot(widget, conversation, caption || filename);

  return NextResponse.json({ message, conversation, visitor, bot: botMessage }, { status: 201 });
}
