import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { applyTimer, castVote, clearVoting, closeVoting, getPrivateMode, setPrivateMode, startVoting } from '@/lib/board-workshop';
import { workshopState } from '@/lib/board-bootstrap';
import { publishBoardEvent } from '@/lib/board-live';
import { cleanDrafts, revealPrivateDrafts, savePrivateDrafts } from '@/lib/board-private';
import { boardPrivateSchema, boardTimerSchema, boardVoteSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const state = workshopState;

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
  const body = (await req.json().catch(() => null)) as { timer?: unknown; vote?: unknown; private?: unknown; drafts?: unknown } | null;
  const canRun = access.level !== 'view';
  /** El resto de los editores abiertos vuelve a leer el taller enseguida (votar solo no avisa: es secreto). */
  let announce = true;
  if (body?.drafts !== undefined) {
    // Lo que esta persona escribió en modo privado (fuera de la escena compartida).
    if (access.level === 'view') return jsonError(403, 'forbidden');
    if (!(await getPrivateMode(workspaceId, id))) return jsonError(409, 'not_private');
    const drafts = cleanDrafts(body.drafts, personId);
    if (!drafts) return jsonError(400, 'invalid_input');
    const saved = await savePrivateDrafts(id, personId, drafts);
    if (saved === 'too_large') return jsonError(413, 'too_large');
    if (saved !== 'ok') return jsonError(400, 'invalid_input');
  } else if (body?.private !== undefined) {
    const parsed = boardPrivateSchema.safeParse(body.private);
    if (!parsed.success) return invalidInput(parsed.error);
    if (!canRun) return jsonError(403, 'forbidden');
    if (!parsed.data.on) {
      // Revelar: lo de todos entra a la escena en un guardado; los demás lo traen con el aviso "saved".
      const version = await revealPrivateDrafts(workspaceId, id, personId);
      if (version !== null) {
        await publishBoardEvent({ boardId: id, workspaceId, socketId: 'server', kind: 'saved', payload: { version } }).catch(() => undefined);
      }
    }
    await setPrivateMode(workspaceId, id, parsed.data.on);
  } else if (body?.timer !== undefined) {
    const parsed = boardTimerSchema.safeParse(body.timer);
    if (!parsed.success) return invalidInput(parsed.error);
    if (!canRun) return jsonError(403, 'forbidden');
    await applyTimer(workspaceId, id, parsed.data);
  } else if (body?.vote !== undefined) {
    const parsed = boardVoteSchema.safeParse(body.vote);
    if (!parsed.success) return invalidInput(parsed.error);
    const v = parsed.data;
    if (v.action === 'vote') {
      announce = false;
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
  if (announce) {
    await publishBoardEvent({ boardId: id, workspaceId, socketId: 'server', kind: 'workshop' }).catch(() => undefined);
  }
  return NextResponse.json(await state(workspaceId, id, personId));
}
