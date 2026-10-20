import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { boardExists } from '@/lib/boards';
import { storeBoardFile } from '@/lib/board-files';
import { BOARD_MAX_FILE_BYTES } from '@/lib/board-file-refs';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  id: z.string().min(1).max(128),
  dataURL: z.string().startsWith('data:').max(Math.ceil((BOARD_MAX_FILE_BYTES * 4) / 3) + 256),
});

/**
 * Sube una imagen pegada en la pizarra antes de guardar la escena. Body:
 * { id, dataURL } (lo que arma Excalidraw). Devuelve { id, url }, la URL
 * propia que reemplaza al base64 en la escena.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const limited = await limitWrites('boards:files', user.actingUser?.id ?? user.id, 120);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  if (!(await boardExists(user.id, id))) return jsonError(404, 'not_found');
  const res = await storeBoardFile(user.id, id, parsed.data.id, parsed.data.dataURL);
  if (res.ok) return NextResponse.json({ id: parsed.data.id, url: res.url }, { status: 201 });
  const status = res.code === 'too_large' ? 413 : res.code === 'file_type_not_allowed' ? 415 : res.code === 'storage_unavailable' ? 503 : 400;
  return jsonError(status, res.code);
}
