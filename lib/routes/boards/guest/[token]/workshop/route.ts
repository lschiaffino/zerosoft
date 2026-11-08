import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPrivateMode, getTimerRow, timerView } from '@/lib/board-workshop';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * Taller visto desde el link de invitado con edición: el timer y el modo
 * privado (para tapar los stickies de los demás). Sin votación: votar pide cuenta.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) return jsonError(404, 'not_found');
  const row = (await getDb().prepare('SELECT id, workspace_id FROM boards WHERE edit_token = ? AND deleted_at IS NULL').get(token)) as
    | { id: string; workspace_id: string }
    | undefined;
  if (!row) return jsonError(404, 'not_found');
  const now = Date.now();
  const timer = await getTimerRow(row.workspace_id, row.id);
  return NextResponse.json(
    { now, timer: timer ? timerView(timer, now) : null, voting: null, privateMode: await getPrivateMode(row.workspace_id, row.id) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
