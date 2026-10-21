import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { applyTimer, castVote, clearVoting, closeVoting, getTimerRow, getVoting, startVoting, timerView } from '@/lib/board-workshop';
import { boardTimerSchema, boardVoteSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function state(workspaceId: string, boardId: string, personId: string) {
  const now = Date.now();
  const row = await getTimerRow(workspaceId, boardId);
  return {
    now,
    timer: row ? timerView(row, now) : null,
    voting: await getVoting(boardId, personId),
  };
}

/** Estado del taller (timer y votación) para el sondeo del editor; `now` es la hora del servidor. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  return NextResponse.json(await state(access.viewer.workspaceId, id, access.viewer.personId));
}

/**
 * Acciones del taller. Body: { timer: {...} } o { vote: {...} } (lib/boards-schema.ts).
 * El timer y abrir/cerrar votaciones piden poder editar; votar, solo ver.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  const { workspaceId, personId } = access.viewer;
  const limited = await limitWrites('boards:workshop', personId, 240);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { timer?: unknown; vote?: unknown } | null;
  const canRun = access.level !== 'view';
  if (body?.timer !== undefined) {
    const parsed = boardTimerSchema.safeParse(body.timer);
    if (!parsed.success) return invalidInput(parsed.error);
    if (!canRun) return jsonError(403, 'forbidden');
    await applyTimer(workspaceId, id, parsed.data);
  } else if (body?.vote !== undefined) {
    const parsed = boardVoteSchema.safeParse(body.vote);
    if (!parsed.success) return invalidInput(parsed.error);
    const v = parsed.data;
    if (v.action === 'vote') {
      const res = await castVote(id, personId, v.elementId, v.delta);
      if (res === 'no_session' || res === 'closed') return jsonError(409, 'voting_closed');
      if (res === 'limit') return jsonError(409, 'no_votes_left');
    } else {
      if (!canRun) return jsonError(403, 'forbidden');
      if (v.action === 'start') await startVoting(workspaceId, id, personId, v.votesPerPerson);
      else if (v.action === 'close') await closeVoting(id);
      else await clearVoting(id);
    }
  } else {
    return jsonError(400, 'invalid_input');
  }
  return NextResponse.json(await state(workspaceId, id, personId));
}
