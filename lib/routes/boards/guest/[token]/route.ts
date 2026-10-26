import { NextRequest, NextResponse } from 'next/server';
import { getGuestBoard } from '@/lib/boards';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pizarra del link de invitado con edición (sin login): lo que pide el editor al recargar o combinar. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const guest = await getGuestBoard(token);
  if (!guest) return jsonError(404, 'not_found');
  return NextResponse.json({ ...guest.board, my_access: 'edit' });
}
