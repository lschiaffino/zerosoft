import { after, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  chatAttachmentType,
  createChatConversation,
  createChatMessage,
  getChatWidget,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  updateChatConversation,
} from '@/lib/chat-data';
import { MAX_UPLOAD_SIZE, isAllowedUpload, saveUpload, UploadError } from '@/lib/uploads';
import { dispatchChatBot } from '@/lib/chat-bot-ai';

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

  // Bot: keywords responde al instante (una vez); el bot AI responde en
  // segundo plano (after) y el widget recibe la respuesta en su polling.
  const botMessage = await dispatchChatBot(widget, conversation, { id: message.id, body: caption || filename }, after);

  return NextResponse.json({ message, conversation, visitor, bot: botMessage }, { status: 201 });
}
