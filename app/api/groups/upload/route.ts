import { NextResponse } from 'next/server';
import { MAX_UPLOAD_SIZE, UploadError, saveUpload } from '@/lib/uploads';
import { groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sube un adjunto para mandarlo por WhatsApp (devuelve la URL que se pasa al enviar). */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) return groupsError(400, 'invalid_input');
  if (file.size > MAX_UPLOAD_SIZE) return groupsError(413, 'file_too_large');
  const filename = (file as File).name || 'file';
  const mimetype = file.type || 'application/octet-stream';
  try {
    const url = await saveUpload('chat', filename, mimetype, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ url, mimetype, filename }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) return groupsError(err.status, err.code);
    return groupsError(500, 'upload_failed');
  }
}
