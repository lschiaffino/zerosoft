import { NextRequest, NextResponse } from 'next/server';
import { contentDisposition } from '@/lib/docs-files';
import { fileForMember } from '@/lib/forms/responses';
import { readFormFile } from '@/lib/forms/files';
import { fJson, formsActor } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ fileId: string }> };

/**
 * GET (?download=1): un archivo de una respuesta, solo para quien ve el form.
 * Imágenes y PDF se muestran; el resto baja como descarga. Sin caché pública.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const file = await fileForMember(a.actor, (await params).fileId);
  if (!file) return fJson({ error: 'not_found' }, 404);
  const bytes = await readFormFile(file.ref);
  if (!bytes) return fJson({ error: 'not_found' }, 404);
  const viewable = file.mime === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(file.mime);
  const inline = viewable && req.nextUrl.searchParams.get('download') !== '1';
  return new NextResponse(new Uint8Array(bytes) as BodyInit, {
    headers: {
      'Content-Type': inline ? file.mime : 'application/octet-stream',
      'Content-Disposition': contentDisposition(file.name, inline),
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': inline ? "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'" : "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
