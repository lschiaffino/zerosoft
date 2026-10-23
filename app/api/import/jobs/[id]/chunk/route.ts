import { NextRequest, NextResponse } from 'next/server';
import { ImportError } from '@/lib/import-jobs';
import { importError, importJobFor } from '@/lib/import-http';
import { appendLocalChunk, NOTION_CHUNK_BYTES } from '@/lib/docs-notion-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Subida por partes del zip de Notion cuando no hay Vercel Blob (dev y
 * self-host): cada PUT trae hasta 4 MB en el body y el offset donde va. Un
 * reintento de la misma parte la reescribe.
 */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const res = await importJobFor((await props.params).id);
  if (res instanceof NextResponse) return res;
  const { job } = res;
  if (job.status !== 'uploading' || !job.payload?.startsWith('file:')) return importError(409, 'not_uploading');
  const offset = Number(req.nextUrl.searchParams.get('offset'));
  if (!Number.isInteger(offset) || offset < 0) return importError(400, 'invalid_input');
  const chunk = Buffer.from(await req.arrayBuffer());
  if (chunk.length === 0 || chunk.length > NOTION_CHUNK_BYTES) return importError(413, 'file_too_large');
  if (offset + chunk.length > Number(job.options.size)) return importError(400, 'invalid_input');
  try {
    return NextResponse.json({ uploaded: await appendLocalChunk(job.id, offset, chunk) });
  } catch (err) {
    if (err instanceof ImportError) return importError(409, err.code);
    throw err;
  }
}
