import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { sanitizeBlocks, sanitizeDocsHtml } from '@/lib/docs-sanitize';
import { DOCS_IMPORT_MAX_BYTES, docsImportKind, markdownToBlocks } from '@/lib/docs-import';
import { docxToBlocks, DocxImportError } from '@/lib/docs-docx';
import { docsError, forbidden, notFound, unauthorized } from '@/lib/docs-http';
import type { DocsBlock } from '@/lib/docs-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Convierte un .md o .docx en bloques para la página. No la guarda: el editor
 * los agrega y guarda con su flujo normal (así no pisa lo que se está
 * escribiendo). Hace falta poder editar la página.
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
  if (file.size > DOCS_IMPORT_MAX_BYTES) return docsError(413, 'file_too_large');
  const kind = docsImportKind((file as File).name ?? '');
  if (!kind) return docsError(415, 'file_type_not_allowed');

  let blocks: DocsBlock[];
  try {
    blocks =
      kind === 'docx'
        ? docxToBlocks(await file.arrayBuffer())
        : markdownToBlocks(await file.text(), { sanitize: sanitizeDocsHtml });
  } catch (err) {
    if (err instanceof DocxImportError) return docsError(422, err.code);
    throw err;
  }
  return NextResponse.json({ blocks: sanitizeBlocks(blocks) });
}
