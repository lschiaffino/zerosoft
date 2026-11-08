import { NextRequest, NextResponse } from 'next/server';
import { AttachmentError, attachmentView, createAttachment, MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentView } from '@/lib/assistant/files';
import { assistantUser, owner } from '@/lib/assistant/http';
import { sameSiteRequest } from '@/lib/oauth/consent';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<AttachmentError['code'] | 'upload_failed', number> = {
  file_too_large: 413,
  file_type_not_allowed: 415,
  invalid_input: 400,
  storage_unavailable: 503,
  upload_failed: 500,
};

/**
 * Adjuntos del asistente (multipart, campo `file`, uno o varios). Devuelve
 * { files: [{ id, name, mime, size, url, kind }], errors: [{ name, error }] }.
 * Si ninguno se pudo subir, el status es el del primer error.
 */
export async function POST(req: NextRequest) {
  // Sube con la sesión: solo desde una página de este sitio (como la pantalla de permisos).
  if (!sameSiteRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const who = owner(user);
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const limited = await rateLimit(`assistant-files:${who.personId}`, 60, 3600);
    if (!limited.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  const blobs = form ? form.getAll('file').filter((f): f is File => f instanceof Blob) : [];
  if (!blobs.length) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (blobs.length > MAX_ATTACHMENTS_PER_MESSAGE) return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  const files: AttachmentView[] = [];
  const errors: Array<{ name: string; error: keyof typeof STATUS }> = [];
  for (const file of blobs) {
    const name = (file.name || 'file').slice(0, 200);
    try {
      const row = await createAttachment(who, { name, type: file.type || '', bytes: Buffer.from(await file.arrayBuffer()) });
      files.push(attachmentView(row));
    } catch (err) {
      errors.push({ name, error: err instanceof AttachmentError ? err.code : 'upload_failed' });
      if (!(err instanceof AttachmentError)) console.error('[assistant] upload', err instanceof Error ? err.name : 'error');
    }
  }
  if (!files.length) {
    const first = errors[0]?.error ?? 'upload_failed';
    return NextResponse.json({ error: first, files, errors }, { status: STATUS[first] });
  }
  return NextResponse.json({ files, errors }, { status: 201 });
}
