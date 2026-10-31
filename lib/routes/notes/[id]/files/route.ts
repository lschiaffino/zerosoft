import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteEditable, noteOwner } from '@/lib/notes';
import { resolveNoteAccess } from '@/lib/notes-shares';
import { MAX_UPLOAD_SIZE, saveUpload, UploadError } from '@/lib/uploads';
import { cleanFileName, DOCS_MAX_BLOB_UPLOAD, type DocsUploadConfig, type DocsUploadResult } from '@/lib/docs-files';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cómo sube el editor en Notes: con Blob, directo del navegador (.../files/blob);
 * sin Blob, por este servidor hasta MAX_UPLOAD_SIZE. Lo pide el editor al abrir la nota.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await resolveNoteAccess(noteOwner(user), id);
  if (!access) return jsonError(404, 'not_found');
  return NextResponse.json<DocsUploadConfig>(process.env.BLOB_READ_WRITE_TOKEN ? { mode: 'blob', max: DOCS_MAX_BLOB_UPLOAD } : { mode: 'server', max: MAX_UPLOAD_SIZE });
}

/**
 * Sube el archivo de un bloque image/file de una nota (arrastrar, pegar o el
 * menú `/`). La persona dueña o alguien con quien la compartió para editar,
 * con la nota fuera de la papelera. Se
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
  // Propia, o compartida conmigo con permiso de edición.
  const access = await resolveNoteAccess(owner, id);
  if (!access || access.access === 'view') return jsonError(404, 'not_found');
  const state = await noteEditable(access.owner, id);
  if (state === 'not_found') return jsonError(404, 'not_found');
  if (state === 'trashed') return jsonError(409, 'note_trashed');

  if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_SIZE + 64 * 1024) return jsonError(413, 'file_too_large');
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
