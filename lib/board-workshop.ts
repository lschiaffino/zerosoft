/**
 * Board — herramientas de taller: timer compartido y votaciones con puntos.
 *
 * Sin tiempo real: el estado vive en la base y cada editor lo consulta cada
 * pocos segundos (GET /api/boards/[id]/workshop). El timer se guarda como
 * "termina a las X" (corriendo) o "le quedan N segundos" (en pausa): cada
 * cliente calcula lo que falta con la hora del servidor que viene en la
 * respuesta, así no depende del reloj de cada máquina.
 *
 * Votación: una abierta por pizarra. Cada persona reparte N votos entre los
 * elementos (puede poner varios en el mismo). Mientras está abierta cada uno
 * ve solo los suyos; al cerrarla se ven los totales.
 */
import { getDb } from './db';

const nowIso = () => new Date().toISOString();

// ---------- Timer ----------

export interface TimerRow {
  timer_ends_at: string | null;
  timer_seconds: number | null;
  timer_paused_left: number | null;
}

export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

export interface TimerView {
  status: TimerStatus;
  /** Duración elegida al arrancar (segundos). */
  total: number;
  /** Milisegundos que faltan (0 si terminó o no hay timer). */
  remaining_ms: number;
  ends_at: string | null;
}

/** Estado del timer a partir de lo guardado y la hora actual. Puro. */
export function timerView(row: TimerRow, nowMs: number): TimerView {
  const total = Number(row.timer_seconds) || 0;
  if (row.timer_paused_left != null) {
    return { status: 'paused', total, remaining_ms: Math.max(0, Number(row.timer_paused_left)) * 1000, ends_at: null };
  }
  if (!row.timer_ends_at) return { status: 'idle', total, remaining_ms: 0, ends_at: null };
  const left = Date.parse(row.timer_ends_at) - nowMs;
  return { status: left > 0 ? 'running' : 'done', total, remaining_ms: Math.max(0, left), ends_at: row.timer_ends_at };
}

export type TimerAction =
  | { action: 'start'; seconds: number }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'stop' }
  | { action: 'add'; seconds: number };

/** Próximo estado guardado del timer para una acción. Puro. */
export function nextTimer(row: TimerRow, act: TimerAction, nowMs: number): TimerRow {
  const view = timerView(row, nowMs);
  const endsIn = (sec: number) => new Date(nowMs + sec * 1000).toISOString();
  switch (act.action) {
    case 'start':
      return { timer_seconds: act.seconds, timer_ends_at: endsIn(act.seconds), timer_paused_left: null };
    case 'pause':
      if (view.status !== 'running') return row;
      return { ...row, timer_ends_at: null, timer_paused_left: Math.ceil(view.remaining_ms / 1000) };
    case 'resume':
      if (view.status !== 'paused') return row;
      return { ...row, timer_ends_at: endsIn(Number(row.timer_paused_left) || 0), timer_paused_left: null };
    case 'add': {
      if (view.status === 'paused') {
        return { ...row, timer_paused_left: Math.max(0, (Number(row.timer_paused_left) || 0) + act.seconds) };
      }
      if (view.status === 'idle') return row;
      // Corriendo (o recién terminado): se corre el final desde lo que quedaba.
      const left = Math.max(0, Math.ceil(view.remaining_ms / 1000) + act.seconds);
      return { ...row, timer_seconds: Math.max(Number(row.timer_seconds) || 0, left), timer_ends_at: endsIn(left) };
    }
    case 'stop':
      return { timer_seconds: null, timer_ends_at: null, timer_paused_left: null };
  }
}

export async function getTimerRow(workspaceId: string, boardId: string): Promise<TimerRow | null> {
  return ((await getDb()
    .prepare('SELECT timer_ends_at, timer_seconds, timer_paused_left FROM boards WHERE id = ? AND workspace_id = ?')
    .get(boardId, workspaceId)) as TimerRow | undefined) ?? null;
}

export async function applyTimer(workspaceId: string, boardId: string, act: TimerAction, nowMs = Date.now()): Promise<TimerView | null> {
  const row = await getTimerRow(workspaceId, boardId);
  if (!row) return null;
  const next = nextTimer(row, act, nowMs);
  await getDb()
    .prepare('UPDATE boards SET timer_ends_at = ?, timer_seconds = ?, timer_paused_left = ? WHERE id = ? AND workspace_id = ?')
    .run(next.timer_ends_at, next.timer_seconds, next.timer_paused_left, boardId, workspaceId);
  return timerView(next, nowMs);
}

// ---------- Votación ----------

export interface VoteSessionRow {
  id: string;
  board_id: string;
  workspace_id: string;
  created_by: string | null;
  votes_per_person: number;
  status: string; // open | closed | cleared
  created_at: string;
  closed_at: string | null;
}

export interface VotingView {
  id: string;
  status: 'open' | 'closed';
  votes_per_person: number;
  created_by: string | null;
  /** Votos propios por elemento. */
  mine: Record<string, number>;
  /** Votos propios que quedan. */
  left: number;
  /** Cuántas personas votaron (sin decir qué, mientras está abierta). */
  voters: number;
  /** Totales por elemento, de más a menos: solo con la votación cerrada. */
  results: Array<{ element_id: string; count: number }> | null;
}

/** ¿Se puede sumar/restar un voto? Puro: tope por persona y nada negativo. */
export function canVote(mine: Readonly<Record<string, number>>, elementId: string, delta: 1 | -1, perPerson: number): boolean {
  if (delta === -1) return (mine[elementId] ?? 0) > 0;
  const used = Object.values(mine).reduce((s, n) => s + n, 0);
  return used < perPerson;
}

/** Totales por elemento, de más a menos (empate: por id, estable). Puro. */
export function tallyVotes(rows: ReadonlyArray<{ element_id: string; count: number }>): Array<{ element_id: string; count: number }> {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.element_id, (sums.get(r.element_id) ?? 0) + Number(r.count));
  return [...sums.entries()]
    .filter(([, n]) => n > 0)
    .map(([element_id, count]) => ({ element_id, count }))
    .sort((a, b) => b.count - a.count || a.element_id.localeCompare(b.element_id));
}

async function currentSession(boardId: string): Promise<VoteSessionRow | null> {
  return ((await getDb()
    .prepare(`SELECT * FROM board_vote_sessions WHERE board_id = ? AND status IN ('open', 'closed') ORDER BY created_at DESC LIMIT 1`)
    .get(boardId)) as VoteSessionRow | undefined) ?? null;
}

async function myVotes(sessionId: string, voterId: string): Promise<Record<string, number>> {
  const rows = (await getDb()
    .prepare('SELECT element_id, count FROM board_votes WHERE session_id = ? AND voter_id = ? AND count > 0')
    .all(sessionId, voterId)) as Array<{ element_id: string; count: number }>;
  return Object.fromEntries(rows.map((r) => [r.element_id, Number(r.count)]));
}

export async function getVoting(boardId: string, voterId: string): Promise<VotingView | null> {
  const s = await currentSession(boardId);
  if (!s) return null;
  const mine = await myVotes(s.id, voterId);
  const voters = (await getDb()
    .prepare('SELECT COUNT(DISTINCT voter_id) AS n FROM board_votes WHERE session_id = ? AND count > 0')
    .get(s.id)) as { n: number };
  const closed = s.status === 'closed';
  let results: VotingView['results'] = null;
  if (closed) {
    const rows = (await getDb()
      .prepare('SELECT element_id, count FROM board_votes WHERE session_id = ?')
      .all(s.id)) as Array<{ element_id: string; count: number }>;
    results = tallyVotes(rows);
  }
  const used = Object.values(mine).reduce((a, b) => a + b, 0);
  return {
    id: s.id,
    status: closed ? 'closed' : 'open',
    votes_per_person: Number(s.votes_per_person),
    created_by: s.created_by,
    mine,
    left: Math.max(0, Number(s.votes_per_person) - used),
    voters: Number(voters.n),
    results,
  };
}

/** Abre una votación nueva (la anterior, abierta o cerrada, queda descartada). */
export async function startVoting(workspaceId: string, boardId: string, personId: string, votesPerPerson: number): Promise<void> {
  const db = getDb();
  await db
    .prepare(`UPDATE board_vote_sessions SET status = 'cleared', closed_at = COALESCE(closed_at, ?) WHERE board_id = ? AND status IN ('open', 'closed')`)
    .run(nowIso(), boardId);
  await db
    .prepare(
      `INSERT INTO board_vote_sessions (id, board_id, workspace_id, created_by, votes_per_person, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(crypto.randomUUID(), boardId, workspaceId, personId, votesPerPerson, nowIso());
}

export async function closeVoting(boardId: string): Promise<boolean> {
  const res = await getDb()
    .prepare(`UPDATE board_vote_sessions SET status = 'closed', closed_at = ? WHERE board_id = ? AND status = 'open'`)
    .run(nowIso(), boardId);
  return res.changes > 0;
}

/** Descarta los resultados (la pizarra queda sin votación a la vista). */
export async function clearVoting(boardId: string): Promise<void> {
  await getDb()
    .prepare(`UPDATE board_vote_sessions SET status = 'cleared', closed_at = COALESCE(closed_at, ?) WHERE board_id = ? AND status IN ('open', 'closed')`)
    .run(nowIso(), boardId);
}

export type VoteResult = 'ok' | 'no_session' | 'closed' | 'limit';

export async function castVote(boardId: string, voterId: string, elementId: string, delta: 1 | -1): Promise<VoteResult> {
  const s = await currentSession(boardId);
  if (!s) return 'no_session';
  if (s.status !== 'open') return 'closed';
  const mine = await myVotes(s.id, voterId);
  if (!canVote(mine, elementId, delta, Number(s.votes_per_person))) return 'limit';
  if (delta === 1) {
    await getDb()
      .prepare(
        `INSERT INTO board_votes (session_id, voter_id, element_id, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(session_id, voter_id, element_id) DO UPDATE SET count = count + 1`,
      )
      .run(s.id, voterId, elementId);
  } else {
    await getDb()
      .prepare('UPDATE board_votes SET count = count - 1 WHERE session_id = ? AND voter_id = ? AND element_id = ? AND count > 0')
      .run(s.id, voterId, elementId);
  }
  return 'ok';
}
