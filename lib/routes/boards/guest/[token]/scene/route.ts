import { NextRequest } from 'next/server';
import { getGuestBoard } from '@/lib/boards';
import { handleScenePut } from '@/lib/board-scene-http';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Autosave del invitado: mismo contrato que /api/boards/[id]/scene, sin autor (updated_by queda vacío). */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const limited = await limitWrites('boards:guest-scene', token, 120);
  if (limited) return limited;
  const guest = await getGuestBoard(token);
  if (!guest) return jsonError(404, 'not_found');
  return handleScenePut(req, guest.workspaceId, null, guest.board.id, token);
}
