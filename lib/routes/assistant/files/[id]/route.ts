import { NextResponse } from 'next/server';
import { attachmentKind, getAttachments, readAttachmentBytes } from '@/lib/assistant/files';
import { assistantUser, owner } from '@/lib/assistant/http';
import { contentDisposition } from '@/lib/docs-files';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Un adjunto del asistente, solo para la persona que lo subió y en ese
 * workspace. Las imágenes raster se muestran; el resto se descarga. Nada
 * queda en caches compartidos.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const [file] = await getAttachments(owner(user), [id]);
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const bytes = await readAttachmentBytes(file);
  if (!bytes) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const inline = attachmentKind(file.mime) === 'image';
  return new NextResponse(new Uint8Array(bytes) as BodyInit, {
    headers: {
      'Content-Type': inline ? file.mime : 'application/octet-stream',
      'Content-Disposition': contentDisposition(file.name, inline),
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
