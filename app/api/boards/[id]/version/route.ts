import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { getBoardVersion } from '@/lib/boards';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Versión de la escena y quién la guardó último. El editor la sondea con la
 * pestaña visible para traer los cambios de otros sin bajar la escena entera.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  const info = await getBoardVersion(user.id, id);
  if (!info) return jsonError(404, 'not_found');
  return NextResponse.json(info);
}
