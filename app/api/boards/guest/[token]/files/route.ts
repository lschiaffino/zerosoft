import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGuestBoard } from '@/lib/boards';
import { storeBoardFile } from '@/lib/board-files';
import { BOARD_MAX_FILE_BYTES } from '@/lib/board-file-refs';
import { withShareToken } from '@/lib/board-file-refs';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  id: z.string().min(1).max(128),
  dataURL: z.string().startsWith('data:').max(Math.ceil((BOARD_MAX_FILE_BYTES * 4) / 3) + 256),
});

/** Imagen pegada por un invitado: igual que /api/boards/[id]/files, con la URL que lleva su token. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const limited = await limitWrites('boards:guest-files', token, 60);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const guest = await getGuestBoard(token);
  if (!guest) return jsonError(404, 'not_found');
  const res = await storeBoardFile(guest.workspaceId, guest.board.id, parsed.data.id, parsed.data.dataURL);
  if (res.ok) {
    // La URL guardada no lleva token; al invitado se le devuelve con el suyo para poder verla.
    const files = withShareToken({ [parsed.data.id]: { dataURL: res.url } }, guest.board.id, token);
    const url = (files[parsed.data.id] as { dataURL: string }).dataURL;
    return NextResponse.json({ id: parsed.data.id, url }, { status: 201 });
  }
  const status = res.code === 'too_large' ? 413 : res.code === 'file_type_not_allowed' ? 415 : res.code === 'storage_unavailable' ? 503 : 400;
  return jsonError(status, res.code);
}
