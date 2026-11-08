import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { GUEST_VOTER_PREFIX, castVote, getPrivateMode, getTimerRow, getVoting, timerView } from '@/lib/board-workshop';
import { cleanDrafts, draftsView, listPrivateDrafts, savePrivateDrafts } from '@/lib/board-private';
import { publishBoardEvent } from '@/lib/board-live';
import { boardVoteSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;
const KEY_RE = /^guest-[a-z0-9]{6,20}$/;

/** Votante del invitado: su clave de navegador, atada al link (no choca con personas ni con otro link). */
function guestVoter(token: string, key: string): string {
  return `${GUEST_VOTER_PREFIX}${createHash('sha256').update(token).digest('hex').slice(0, 16)}:${key}`;
}

async function boardOf(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  return ((await getDb().prepare('SELECT id, workspace_id FROM boards WHERE edit_token = ? AND deleted_at IS NULL').get(token)) as
    | { id: string; workspace_id: string }
    | undefined) ?? null;
}

async function state(token: string, row: { id: string; workspace_id: string }, key: string | null) {
  const now = Date.now();
  const timer = await getTimerRow(row.workspace_id, row.id);
  const privateMode = await getPrivateMode(row.workspace_id, row.id);
  return {
    now,
    timer: timer ? timerView(timer, now) : null,
    voting: key ? await getVoting(row.id, guestVoter(token, key)) : null,
    privateMode,
    drafts: privateMode ? draftsView(await listPrivateDrafts(row.id), key) : null,
  };
}

/**
 * Taller visto desde el link de invitado con edición: el timer, el modo
 * privado y la votación (con los votos de su navegador, `?k=`).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const row = await boardOf(token);
  if (!row) return jsonError(404, 'not_found');
  const k = req.nextUrl.searchParams.get('k');
  return NextResponse.json(await state(token, row, k && KEY_RE.test(k) ? k : null), { headers: { 'cache-control': 'no-store' } });
}

/** El invitado solo vota (+1 / -1) en la votación abierta; abrir, cerrar y el timer piden cuenta. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const row = await boardOf(token);
  if (!row) return jsonError(404, 'not_found');
  const body = (await req.json().catch(() => null)) as { vote?: unknown; k?: unknown; drafts?: unknown } | null;
  const key = typeof body?.k === 'string' && KEY_RE.test(body.k) ? body.k : null;
  if (!key) return jsonError(400, 'invalid_input');
  const limited = await limitWrites('boards:workshop-guest', guestVoter(token, key), 240);
  if (limited) return limited;
  if (body?.drafts !== undefined) {
    // Lo que el invitado escribe en modo privado: borrador suyo (por la clave de su navegador).
    if (!(await getPrivateMode(row.workspace_id, row.id))) return jsonError(409, 'not_private');
    const drafts = cleanDrafts(body.drafts, key);
    if (!drafts) return jsonError(400, 'invalid_input');
    const saved = await savePrivateDrafts(row.id, key, drafts);
    if (saved !== 'ok') return jsonError(saved === 'too_large' ? 413 : 400, saved === 'too_large' ? 'too_large' : 'invalid_input');
    await publishBoardEvent({ boardId: row.id, workspaceId: row.workspace_id, socketId: 'server', kind: 'workshop' }).catch(() => undefined);
    return NextResponse.json(await state(token, row, key));
  }
  const parsed = boardVoteSchema.safeParse(body?.vote);
  if (!parsed.success) return invalidInput(parsed.error);
  if (parsed.data.action !== 'vote') return jsonError(403, 'forbidden');
  const res = await castVote(row.id, guestVoter(token, key), parsed.data.elementId, parsed.data.delta);
  if (res === 'no_session' || res === 'closed') return jsonError(409, 'voting_closed');
  if (res === 'limit') return jsonError(409, 'no_votes_left');
  return NextResponse.json(await state(token, row, key));
}
