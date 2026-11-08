import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { boardExists } from '@/lib/boards';
import { storeBoardAttachment } from '@/lib/board-files';
import { BOARD_MAX_FILE_BYTES } from '@/lib/board-file-refs';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sube un archivo adjunto (PDF, documento, planilla, presentación, texto o
 * zip) para una tarjeta del lienzo. Body: los bytes del archivo; el nombre va
 * en el header `x-file-name` (codificado con encodeURIComponent). Devuelve
 * { fileId, url, name, mime, size }.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const limited = await limitWrites('boards:attachments', user.actingUser?.id ?? user.id, 60);
  if (limited) return limited;
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > BOARD_MAX_FILE_BYTES) return jsonError(413, 'too_large');
  let name = '';
  try {
    name = decodeURIComponent(req.headers.get('x-file-name') ?? '');
  } catch {
    return jsonError(400, 'invalid_input');
  }
  if (!name) return jsonError(400, 'invalid_input');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!(await boardExists(user.id, id))) return jsonError(404, 'not_found');
  const res = await storeBoardAttachment(user.id, id, name, bytes);
  if (res.ok) return NextResponse.json({ fileId: res.fileId, url: res.url, name: res.name, mime: res.mime, size: res.size }, { status: 201 });
  const status = res.code === 'too_large' ? 413 : res.code === 'file_type_not_allowed' ? 415 : res.code === 'storage_unavailable' ? 503 : 400;
  return jsonError(status, res.code);
}
