import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  chatAttachmentType,
  createChatMessage,
  recordFirstResponse,
} from '@/lib/chat-data';
import { MAX_UPLOAD_SIZE, saveUpload, UploadError } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ok } = await canAccessConversation(params.id, user);
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
