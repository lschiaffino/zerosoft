import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getCurrentUser } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';
import { NOTION_MAX_ZIP_BYTES } from '@/lib/docs-notion-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Token de subida directa a Vercel Blob para el zip de un import (el archivo
 * no pasa por esta función: el navegador lo sube a Blob en partes). Solo zip,
 * hasta 1 GB, bajo imports/ con sufijo aleatorio. Después el navegador crea
 * el job con la URL; el zip se borra al terminar, fallar o cancelar.
 */
export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  // El aviso de "subida completa" lo manda Blob (sin sesión): no se usa.
  if (body.type === 'blob.generate-client-token') {
    const limited = await limitByIp(req, 'import-upload', 20, 600);
    if (limited) return limited;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^imports\/[A-Za-z0-9._-]{1,120}\.zip$/.test(pathname)) throw new Error('invalid_pathname');
        return {
          allowedContentTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
          maximumSizeInBytes: NOTION_MAX_ZIP_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'upload_failed' }, { status: 400 });
  }
}
