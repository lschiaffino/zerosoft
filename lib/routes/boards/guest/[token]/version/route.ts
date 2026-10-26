import { NextRequest, NextResponse } from 'next/server';
import { getGuestBoardVersion } from '@/lib/boards';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Versión de la pizarra del link de invitado con edición: el sondeo del editor (sin login). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const info = await getGuestBoardVersion(token);
  if (!info) return jsonError(404, 'not_found');
  return NextResponse.json(info);
}
