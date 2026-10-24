import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getCurrentUser } from '@/lib/session';
import { MAX_DOCUMENT_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES } from '@/lib/crm-media-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Token de subida directa a Vercel Blob para documentos (PDF) y videos del
 * CRM. Solo con sesión, solo bajo crm/ y con tipo y tamaño acotados. El
 * registro en la base lo hace después POST /api/crm/documents o /videos.
 */
export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await getCurrentUser();
        if (!user) throw new Error('unauthorized');
        if (!pathname.startsWith('crm/') || pathname.includes('..')) throw new Error('invalid_path');
        const kind = clientPayload === 'video' ? 'video' : 'document';
        return {
          allowedContentTypes: kind === 'video' ? [...VIDEO_TYPES] : ['application/pdf'],
          maximumSizeInBytes: kind === 'video' ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const code = err instanceof Error && err.message === 'unauthorized' ? 'unauthorized' : 'upload_failed';
    return NextResponse.json({ error: code }, { status: code === 'unauthorized' ? 401 : 400 });
  }
}
