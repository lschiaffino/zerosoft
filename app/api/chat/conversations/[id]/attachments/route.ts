import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  chatAttachmentType,
  createChatMessage,
  getCannedResponse,
  recordFirstResponse,
  reopenIfResolved,
} from '@/lib/chat-data';
import { applyCannedMacro } from '@/lib/chat-inbox';
import { MAX_UPLOAD_SIZE, saveUpload, UploadError } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ok, conversation } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  const caption = typeof form.get('body') === 'string' ? (form.get('body') as string).trim() : '';
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = (file as File).name || 'upload';
  const mime = file.type || 'application/octet-stream';
  let url: string;
  try {
    url = await saveUpload('chat', filename, mime, buffer);
  } catch (err) {
    if (err instanceof UploadError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }

  const message = await createChatMessage(params.id, 'user', {
    body: caption,
    userId: realUserId(user),
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
  if (conversation) await reopenIfResolved(conversation);

  // Macro elegida en el composer: se aplica al enviar, después de reabrir.
  const cannedId = form.get('cannedId');
  if (conversation && typeof cannedId === 'string' && cannedId) {
    const canned = await getCannedResponse(cannedId);
    if (canned && canned.widget_id === conversation.widget_id) {
      await applyCannedMacro(params.id, canned, realUserId(user));
    }
  }

  return NextResponse.json(message, { status: 201 });
}
