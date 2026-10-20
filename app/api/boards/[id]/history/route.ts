import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { boardExists } from '@/lib/boards';
import { listSnapshots } from '@/lib/board-history';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Versiones guardadas de la pizarra (una por hora de edición), la más nueva primero. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!(await boardExists(user.id, id))) return jsonError(404, 'not_found');
  return NextResponse.json({ snapshots: await listSnapshots(user.id, id) });
}
