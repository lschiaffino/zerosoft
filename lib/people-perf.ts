/**
 * People: desempeño. Ciclos de evaluación con autoevaluación, evaluación del
 * manager y de pares (preguntas de texto y de puntaje 1 a 5), objetivos con
 * avance y notas 1:1 privadas entre las dos personas. Server-only.
 *
 * Quién ve qué:
 * - Quien evalúa ve y completa su evaluación.
 * - HR ve todo el ciclo.
 * - El manager ve las evaluaciones de sus reportes.
 * - La persona evaluada ve su autoevaluación y, con el ciclo cerrado, la de su
 *   manager. Las de pares no las ve nunca con nombre.
 */
import { getDb } from './db';
import { canSeeOneOnOne, canSeeSensitive, isManagerOf, isSelf } from './people-access';
import { isIsoDate } from './people-time';
import { audit, getEmployeeRow, newId, nowIso, parseJson, PeopleError, requireHr, type PeopleCtx } from './people';
import { notifyPeople } from './people-effects';

const db = () => getDb();

export interface Question {
  id: string;
  text: string;
  kind: 'rating' | 'text';
}

export interface Cycle {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'closed';
  questions: Question[];
  selfReview: boolean;
  managerReview: boolean;
  peerReview: boolean;
  dueDate: string | null;
  updatedAt: string;
  progress: { submitted: number; total: number };
}

export const DEFAULT_QUESTIONS: Question[] = [
  { id: 'q1', text: 'What went well this period?', kind: 'text' },
  { id: 'q2', text: 'What could be better?', kind: 'text' },
  { id: 'q3', text: 'Overall performance', kind: 'rating' },
];

function cleanQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return DEFAULT_QUESTIONS;
  const out = raw.slice(0, 20).flatMap((q, i) => {
    const o = (q ?? {}) as Record<string, unknown>;
    const text = String(o.text ?? '').trim().slice(0, 300);
    if (!text) return [];
    const id = typeof o.id === 'string' && /^[a-z0-9_]{1,20}$/i.test(o.id) ? o.id : `q${i + 1}`;
    return [{ id, text, kind: o.kind === 'rating' ? ('rating' as const) : ('text' as const) }];
  });
  return out.length ? out : DEFAULT_QUESTIONS;
}

async function toCycle(r: Record<string, unknown>): Promise<Cycle> {
  const p = (await db().prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS done FROM people_reviews WHERE cycle_id = ?").get(r.id as string)) as {
    total: number;
    done: number | null;
  };
  return {
    id: String(r.id),
    name: String(r.name),
    status: (['draft', 'active', 'closed'].includes(String(r.status)) ? r.status : 'draft') as Cycle['status'],
    questions: cleanQuestions(parseJson(r.questions, [])),
    selfReview: Number(r.self_review) === 1,
    managerReview: Number(r.manager_review) === 1,
    peerReview: Number(r.peer_review) === 1,
    dueDate: (r.due_date as string | null) ?? null,
    updatedAt: String(r.updated_at),
    progress: { submitted: Number(p.done ?? 0), total: Number(p.total) },
  };
}

/** Ciclos: HR los ve todos; el resto, los ciclos donde evalúa o es evaluado. */
export async function listCycles(ctx: PeopleCtx): Promise<Cycle[]> {
  const rows = (await db().prepare('SELECT * FROM people_cycles WHERE workspace_id = ? ORDER BY created_at DESC').all(ctx.ws)) as Array<Record<string, unknown>>;
  if (ctx.viewer.hr) return Promise.all(rows.map(toCycle));
  const me = ctx.viewer.employeeId;
  if (!me) return [];
  const mine = new Set(
    ((await db().prepare('SELECT DISTINCT cycle_id FROM people_reviews WHERE workspace_id = ? AND (reviewer_id = ? OR subject_id = ?)').all(ctx.ws, me, me)) as Array<{ cycle_id: string }>).map(
      (r) => r.cycle_id,
    ),
  );
  return Promise.all(rows.filter((r) => mine.has(String(r.id)) && r.status !== 'draft').map(toCycle));
}

export async function getCycle(ctx: PeopleCtx, id: string): Promise<Cycle | null> {
  const r = (await db().prepare('SELECT * FROM people_cycles WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as Record<string, unknown> | undefined;
  if (!r) return null;
  if (!ctx.viewer.hr) {
    const me = ctx.viewer.employeeId;
    const involved = me && (await db().prepare('SELECT 1 AS x FROM people_reviews WHERE cycle_id = ? AND (reviewer_id = ? OR subject_id = ?) LIMIT 1').get(id, me, me));
    if (!involved || r.status === 'draft') return null;
  }
  return toCycle(r);
}

export async function createCycle(ctx: PeopleCtx, input: Record<string, unknown>): Promise<Cycle> {
  requireHr(ctx);
  const name = String(input.name ?? '').trim().slice(0, 120);
  if (!name) throw new PeopleError('name_required');
  const id = newId('cyc');
  const now = nowIso();
  await db()
    .prepare(
      `INSERT INTO people_cycles (id, workspace_id, name, status, questions, self_review, manager_review, peer_review, due_date, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ctx.ws,
      name,
      JSON.stringify(cleanQuestions(input.questions)),
      input.selfReview === false ? 0 : 1,
      input.managerReview === false ? 0 : 1,
      input.peerReview === true ? 1 : 0,
      isIsoDate(input.dueDate) ? input.dueDate : null,
      now,
      now,
    );
  return (await getCycle(ctx, id))!;
}

export async function updateCycle(ctx: PeopleCtx, id: string, input: Record<string, unknown>): Promise<Cycle> {
  requireHr(ctx);
  const cur = await getCycle(ctx, id);
  if (!cur) throw new PeopleError('not_found', 404);
  const name = input.name !== undefined ? String(input.name).trim().slice(0, 120) : cur.name;
  if (!name) throw new PeopleError('name_required');
  // Las preguntas y los tipos de evaluación se fijan al lanzar.
  const draft = cur.status === 'draft';
  await db()
    .prepare('UPDATE people_cycles SET name = ?, questions = ?, self_review = ?, manager_review = ?, peer_review = ?, due_date = ?, updated_at = ? WHERE id = ?')
    .run(
      name,
      JSON.stringify(draft && input.questions !== undefined ? cleanQuestions(input.questions) : cur.questions),
      (draft && input.selfReview !== undefined ? input.selfReview !== false : cur.selfReview) ? 1 : 0,
      (draft && input.managerReview !== undefined ? input.managerReview !== false : cur.managerReview) ? 1 : 0,
      (draft && input.peerReview !== undefined ? input.peerReview === true : cur.peerReview) ? 1 : 0,
      input.dueDate !== undefined ? (isIsoDate(input.dueDate) ? input.dueDate : null) : cur.dueDate,
      nowIso(),
      id,
    );
  if (input.status === 'closed' && cur.status === 'active') await db().prepare("UPDATE people_cycles SET status = 'closed' WHERE id = ?").run(id);
  return (await getCycle(ctx, id))!;
}

export async function deleteCycle(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare('DELETE FROM people_cycles WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
}

/**
 * Lanzar: arma las evaluaciones de cada persona activa (o de las elegidas):
 * autoevaluación, la del manager (si tiene) y hasta dos pares (quienes
 * comparten manager). Avisa a cada evaluador.
 */
export async function launchCycle(ctx: PeopleCtx, id: string, employeeIds?: string[]): Promise<Cycle> {
  requireHr(ctx);
  const cycle = await getCycle(ctx, id);
  if (!cycle) throw new PeopleError('not_found', 404);
  if (cycle.status !== 'draft') throw new PeopleError('already_launched', 409);
  const claimed = await db().prepare("UPDATE people_cycles SET status = 'active', updated_at = ? WHERE id = ? AND status = 'draft'").run(nowIso(), id);
  if (!claimed.changes) throw new PeopleError('already_launched', 409);
  const all = (await db().prepare("SELECT id, user_id, manager_id FROM people_employees WHERE workspace_id = ? AND status IN ('active', 'onboarding')").all(ctx.ws)) as Array<{
    id: string;
    user_id: string | null;
    manager_id: string | null;
  }>;
  const subjects = employeeIds?.length ? all.filter((e) => employeeIds.includes(e.id)) : all;
  const insert = (subject: string, reviewer: string, kind: string) =>
    db().prepare('INSERT OR IGNORE INTO people_reviews (id, workspace_id, cycle_id, subject_id, reviewer_id, kind) VALUES (?, ?, ?, ?, ?, ?)').run(newId('rev'), ctx.ws, id, subject, reviewer, kind);
  const reviewers = new Set<string>();
  for (const s of subjects) {
    if (cycle.selfReview) {
      await insert(s.id, s.id, 'self');
      if (s.user_id) reviewers.add(s.user_id);
    }
    if (cycle.managerReview && s.manager_id) {
      await insert(s.id, s.manager_id, 'manager');
      const m = all.find((e) => e.id === s.manager_id);
      if (m?.user_id) reviewers.add(m.user_id);
    }
    if (cycle.peerReview && s.manager_id) {
      for (const p of all.filter((e) => e.manager_id === s.manager_id && e.id !== s.id).slice(0, 2)) {
        await insert(s.id, p.id, 'peer');
        if (p.user_id) reviewers.add(p.user_id);
      }
    }
  }
  await notifyPeople([...reviewers], { title: `Review cycle started: ${cycle.name}`, href: '/app/people/reviews', sourceId: id });
  return (await getCycle(ctx, id))!;
}

export interface ReviewDto {
  id: string;
  cycleId: string;
  cycleName: string;
  cycleStatus: string;
  subjectId: string;
  subjectName: string;
  /** null en las de pares para la persona evaluada. */
  reviewerName: string | null;
  kind: 'self' | 'manager' | 'peer';
  status: 'pending' | 'submitted';
  answers: Record<string, string | number>;
  submittedAt: string | null;
  questions: Question[];
  canWrite: boolean;
}

type ReviewRow = Record<string, string | null> & { answers: string };

function canSeeReview(ctx: PeopleCtx, r: ReviewRow): boolean {
  if (ctx.viewer.hr) return true;
  if (r.reviewer_id === ctx.viewer.employeeId) return true;
  if (isManagerOf(ctx.viewer, String(r.subject_id))) return true;
  if (isSelf(ctx.viewer, String(r.subject_id))) {
    if (r.kind === 'self') return true;
    if (r.kind === 'manager') return r.cycle_status === 'closed' && r.status === 'submitted';
  }
  return false;
}

/** Evaluaciones de un ciclo (o de una persona) que quien mira puede ver. Ver evaluaciones ajenas queda auditado. */
export async function listReviews(ctx: PeopleCtx, opts: { cycleId?: string; subjectId?: string; mineToWrite?: boolean } = {}): Promise<ReviewDto[]> {
  const where = ['r.workspace_id = ?'];
  const args: string[] = [ctx.ws];
  if (opts.cycleId) {
    where.push('r.cycle_id = ?');
    args.push(opts.cycleId);
  }
  if (opts.subjectId) {
    where.push('r.subject_id = ?');
    args.push(opts.subjectId);
  }
  if (opts.mineToWrite) {
    where.push("r.reviewer_id = ? AND r.status = 'pending' AND c.status = 'active'");
    args.push(ctx.viewer.employeeId ?? '-');
  }
  const rows = (await db()
    .prepare(
      `SELECT r.*, c.name AS cycle_name, c.status AS cycle_status, c.questions, s.name AS subject_name, v.name AS reviewer_name
       FROM people_reviews r JOIN people_cycles c ON c.id = r.cycle_id JOIN people_employees s ON s.id = r.subject_id JOIN people_employees v ON v.id = r.reviewer_id
       WHERE ${where.join(' AND ')} AND c.status != 'draft' ORDER BY s.name COLLATE NOCASE, r.kind`,
    )
    .all(...args)) as ReviewRow[];
  const visible = rows.filter((r) => canSeeReview(ctx, r));
  const foreign = new Set(visible.filter((r) => r.reviewer_id !== ctx.viewer.employeeId && !isSelf(ctx.viewer, String(r.subject_id))).map((r) => String(r.subject_id)));
  for (const s of foreign) await audit(ctx, 'view', 'performance', s);
  return visible.map((r) => {
    const hidePeer = r.kind === 'peer' && isSelf(ctx.viewer, String(r.subject_id)) && !ctx.viewer.hr;
    return {
      id: String(r.id),
      cycleId: String(r.cycle_id),
      cycleName: String(r.cycle_name),
      cycleStatus: String(r.cycle_status),
      subjectId: String(r.subject_id),
      subjectName: String(r.subject_name),
      reviewerName: hidePeer ? null : (r.reviewer_name as string),
      kind: r.kind as ReviewDto['kind'],
      status: r.status === 'submitted' ? 'submitted' : 'pending',
      answers: parseJson<Record<string, string | number>>(r.answers, {}),
      submittedAt: r.submitted_at ?? null,
      questions: cleanQuestions(parseJson(r.questions, [])),
      canWrite: r.reviewer_id === ctx.viewer.employeeId && r.status === 'pending' && r.cycle_status === 'active',
    };
  });
}

export async function submitReview(ctx: PeopleCtx, reviewId: string, input: { answers?: Record<string, unknown>; submit?: boolean }): Promise<ReviewDto> {
  const r = (await db()
    .prepare('SELECT r.*, c.status AS cycle_status, c.questions FROM people_reviews r JOIN people_cycles c ON c.id = r.cycle_id WHERE r.id = ? AND r.workspace_id = ?')
    .get(reviewId, ctx.ws)) as ReviewRow | undefined;
  if (!r) throw new PeopleError('not_found', 404);
  if (r.reviewer_id !== ctx.viewer.employeeId) throw new PeopleError('forbidden', 403);
  if (r.status === 'submitted' || r.cycle_status !== 'active') throw new PeopleError('not_editable', 409);
  const questions = cleanQuestions(parseJson(r.questions, []));
  const answers: Record<string, string | number> = {};
  for (const q of questions) {
    const v = input.answers?.[q.id];
    if (v == null || v === '') continue;
    if (q.kind === 'rating') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new PeopleError('invalid_rating');
      answers[q.id] = n;
    } else answers[q.id] = String(v).slice(0, 4000);
  }
  if (input.submit && questions.some((q) => answers[q.id] == null)) throw new PeopleError('answers_required');
  await db()
    .prepare('UPDATE people_reviews SET answers = ?, status = ?, submitted_at = ? WHERE id = ?')
    .run(JSON.stringify(answers), input.submit ? 'submitted' : 'pending', input.submit ? nowIso() : null, reviewId);
  return (await listReviews(ctx, { cycleId: String(r.cycle_id) })).find((x) => x.id === reviewId)!;
}

// ---------- Objetivos ----------

export interface Goal {
  id: string;
  employeeId: string;
  title: string;
  progress: number;
  dueDate: string | null;
  updatedAt: string;
}

export async function listGoals(ctx: PeopleCtx, employeeId: string): Promise<Goal[]> {
  if (!canSeeSensitive(ctx.viewer, employeeId, 'performance')) throw new PeopleError('forbidden', 403);
  const rows = (await db().prepare('SELECT * FROM people_goals WHERE workspace_id = ? AND employee_id = ? ORDER BY created_at').all(ctx.ws, employeeId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ id: String(r.id), employeeId: String(r.employee_id), title: String(r.title), progress: Number(r.progress), dueDate: (r.due_date as string | null) ?? null, updatedAt: String(r.updated_at) }));
}

export async function createGoal(ctx: PeopleCtx, employeeId: string, input: Record<string, unknown>): Promise<Goal> {
  if (!canSeeSensitive(ctx.viewer, employeeId, 'performance')) throw new PeopleError('forbidden', 403);
  if (!(await getEmployeeRow(ctx.ws, employeeId))) throw new PeopleError('not_found', 404);
  const title = String(input.title ?? '').trim().slice(0, 200);
  if (!title) throw new PeopleError('title_required');
  const id = newId('gol');
  const now = nowIso();
  const progress = Math.max(0, Math.min(100, Math.round(Number(input.progress) || 0)));
  await db()
    .prepare('INSERT INTO people_goals (id, workspace_id, employee_id, title, progress, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.ws, employeeId, title, progress, isIsoDate(input.dueDate) ? input.dueDate : null, now, now);
  return { id, employeeId, title, progress, dueDate: isIsoDate(input.dueDate) ? input.dueDate : null, updatedAt: now };
}

export async function updateGoal(ctx: PeopleCtx, id: string, input: Record<string, unknown>): Promise<void> {
  const g = (await db().prepare('SELECT * FROM people_goals WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as Record<string, unknown> | undefined;
  if (!g) throw new PeopleError('not_found', 404);
  if (!canSeeSensitive(ctx.viewer, String(g.employee_id), 'performance')) throw new PeopleError('forbidden', 403);
  const title = input.title !== undefined ? String(input.title).trim().slice(0, 200) : String(g.title);
  if (!title) throw new PeopleError('title_required');
  const progress = input.progress !== undefined ? Math.max(0, Math.min(100, Math.round(Number(input.progress) || 0))) : Number(g.progress);
  const due = input.dueDate !== undefined ? (isIsoDate(input.dueDate) ? input.dueDate : null) : (g.due_date as string | null);
  await db().prepare('UPDATE people_goals SET title = ?, progress = ?, due_date = ?, updated_at = ? WHERE id = ?').run(title, progress, due, nowIso(), id);
}

export async function deleteGoal(ctx: PeopleCtx, id: string): Promise<boolean> {
  const g = (await db().prepare('SELECT employee_id FROM people_goals WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as { employee_id: string } | undefined;
  if (!g) return false;
  if (!canSeeSensitive(ctx.viewer, g.employee_id, 'performance')) throw new PeopleError('forbidden', 403);
  return (await db().prepare('DELETE FROM people_goals WHERE id = ?').run(id)).changes > 0;
}

// ---------- 1:1 (solo las dos personas) ----------

export interface OneOnOne {
  id: string;
  otherId: string;
  otherName: string;
  date: string;
  notes: string;
  updatedAt: string;
}

/** Notas 1:1 de quien mira con otra persona. Nadie más las ve (ni HR). */
export async function listOneOnOnes(ctx: PeopleCtx, otherId: string): Promise<OneOnOne[]> {
  const me = ctx.viewer.employeeId;
  if (!me || me === otherId) return [];
  const rows = (await db()
    .prepare(
      `SELECT o.*, e.name AS other_name FROM people_one_on_ones o JOIN people_employees e ON e.id = ?
       WHERE o.workspace_id = ? AND ((o.a_id = ? AND o.b_id = ?) OR (o.a_id = ? AND o.b_id = ?)) ORDER BY o.date DESC`,
    )
    .all(otherId, ctx.ws, me, otherId, otherId, me)) as Array<Record<string, string>>;
  return rows
    .filter((r) => canSeeOneOnOne(ctx.viewer, { aId: r.a_id, bId: r.b_id }))
    .map((r) => ({ id: r.id, otherId, otherName: r.other_name, date: r.date, notes: r.notes, updatedAt: r.updated_at }));
}

export async function createOneOnOne(ctx: PeopleCtx, otherId: string, input: Record<string, unknown>): Promise<OneOnOne> {
  const me = ctx.viewer.employeeId;
  if (!me || me === otherId) throw new PeopleError('forbidden', 403);
  const other = await getEmployeeRow(ctx.ws, otherId);
  if (!other) throw new PeopleError('not_found', 404);
  const date = isIsoDate(input.date) ? input.date : new Date().toISOString().slice(0, 10);
  const id = newId('one');
  const now = nowIso();
  await db()
    .prepare('INSERT INTO people_one_on_ones (id, workspace_id, a_id, b_id, date, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.ws, me, otherId, date, String(input.notes ?? '').slice(0, 20000), ctx.personId, now, now);
  return { id, otherId, otherName: other.name, date, notes: String(input.notes ?? '').slice(0, 20000), updatedAt: now };
}

async function ownOneOnOne(ctx: PeopleCtx, id: string) {
  const r = (await db().prepare('SELECT * FROM people_one_on_ones WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as { a_id: string; b_id: string } | undefined;
  if (!r || !canSeeOneOnOne(ctx.viewer, { aId: r.a_id, bId: r.b_id })) throw new PeopleError('not_found', 404);
}

export async function updateOneOnOne(ctx: PeopleCtx, id: string, input: Record<string, unknown>): Promise<void> {
  await ownOneOnOne(ctx, id);
  if (input.notes !== undefined) await db().prepare('UPDATE people_one_on_ones SET notes = ?, updated_at = ? WHERE id = ?').run(String(input.notes).slice(0, 20000), nowIso(), id);
  if (isIsoDate(input.date)) await db().prepare('UPDATE people_one_on_ones SET date = ?, updated_at = ? WHERE id = ?').run(input.date, nowIso(), id);
}

export async function deleteOneOnOne(ctx: PeopleCtx, id: string): Promise<boolean> {
  await ownOneOnOne(ctx, id);
  return (await db().prepare('DELETE FROM people_one_on_ones WHERE id = ?').run(id)).changes > 0;
}
