import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteEditable, noteOwner } from '@/lib/notes';
import { MAX_UPLOAD_SIZE, saveUpload, UploadError } from '@/lib/uploads';
import { cleanFileName, type DocsUploadResult } from '@/lib/docs-files';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sube el archivo de un bloque image/file de una nota (arrastrar, pegar o el
 * menú `/`). Solo la persona dueña y con la nota fuera de la papelera. Se
 * guarda en el storage de Docs (mismas reglas: 10 MB, sin HTML/SVG/JS) y se
 * sirve después por /api/notes/<nota>/files/<bloque>, que vuelve a chequear.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:upload', owner.personId, 60);
  if (limited) return limited;
  const state = await noteEditable(owner, id);
  if (state === 'not_found') return jsonError(404, 'not_found');
  if (state === 'trashed') return jsonError(409, 'note_trashed');

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) return jsonError(400, 'invalid_input');
  if (file.size > MAX_UPLOAD_SIZE) return jsonError(413, 'file_too_large');

  const name = cleanFileName((file as File).name) || 'file';
  const mime = file.type || 'application/octet-stream';
  let url: string;
  try {
    url = await saveUpload('docs', name, mime, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof UploadError) return jsonError(err.status, err.code);
    throw err;
  }
  return NextResponse.json<DocsUploadResult>({ url, name, size: file.size, mime }, { status: 201 });
}
