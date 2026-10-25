import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { saveUpload, UploadError } from '@/lib/uploads';
import { cleanFileName, DOCS_MAX_BLOB_UPLOAD, DOCS_MAX_UPLOAD, type DocsUploadConfig, type DocsUploadResult } from '@/lib/docs-files';
import { docsError, forbidden, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cómo sube el editor: directo a Vercel Blob (hasta 5 GB, ver ./blob) o por
 * este servidor a disco local (servidor propio sin Blob, hasta 50 MB).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  const config: DocsUploadConfig = process.env.BLOB_READ_WRITE_TOKEN
    ? { mode: 'blob', max: DOCS_MAX_BLOB_UPLOAD }
    : { mode: 'server', max: DOCS_MAX_UPLOAD };
  return NextResponse.json(config);
}

/**
 * Sube el archivo de un bloque image/file. Hace falta poder editar la página
 * (dueño o share de edición). Devuelve lo que el editor guarda en el bloque;
 * el archivo se sirve después por /api/docs/files/<página>/<bloque>.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  if (access === 'view') return forbidden();

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) return docsError(400, 'invalid_input');
  if (file.size > DOCS_MAX_UPLOAD) return docsError(413, 'file_too_large');

  const name = cleanFileName((file as File).name) || 'file';
  const mime = file.type || 'application/octet-stream';
  let url: string;
  try {
    url = await saveUpload('docs', name, mime, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof UploadError) return docsError(err.status, err.code);
    throw err;
  }
  return NextResponse.json<DocsUploadResult>({ url, name, size: file.size, mime }, { status: 201 });
}
