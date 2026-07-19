import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  chatAttachmentType,
  createChatMessage,
  getChatConversation,
  getChatWidget,
  recordFirstResponse,
} from '@/lib/chat-data';
import { saveChatFile } from '@/lib/chat-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function canAccessConversation(
  conversationId: string,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  const conversation = await getChatConversation(conversationId);
  if (!conversation) return false;
  const widget = await getChatWidget(conversation.widget_id);
  if (!widget) return false;
  if (widget.user_id !== user.id && widget.team_id !== user.team?.id) {
    return false;
  }
  return true;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ok = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  const caption = typeof form.get('body') === 'string' ? (form.get('body') as string).trim() : '';
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = (file as File).name || 'upload';
  const mime = file.type || 'application/octet-stream';
  const url = await saveChatFile(filename, buffer);

  const message = await createChatMessage(params.id, 'user', {
    body: caption,
    userId: user.id,
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

  await recordFirstResponse(params.id);

  return NextResponse.json(message, { status: 201 });
}
