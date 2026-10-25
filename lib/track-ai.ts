/**
 * Track — IA: sugerencias de triage (asignado, labels, prioridad y
 * duplicados, como Triage Intelligence de Linear), resumen del issue y de su
 * discusión, borrador del update de un proyecto e issue desde texto libre.
 *
 * Todo pasa por lib/ai.ts (cuota del workspace, rate limit y ai_usage). En
 * e2e, TRACK_AI_FAKE=1 usa el modelo falso de lib/crm-ai-fake.ts con una
 * respuesta calculada acá (heurística, sin proveedor); la cookie
 * track_ai_fake=off hace que el request se comporte como sin IA. Nunca se
 * activa en un deploy de producción de Vercel.
 * Server-only.
 */
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { AiError, aiEnabled, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel } from './crm-ai-fake';
import { getDb } from './db';
import { parseIssueLabels, projectWorkspaceId } from './track-labels';
import { getTriageSettings } from './track-triage';
import type { AiSuggestionKind } from './track-triage-shared';

const LOCALE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

// ---------- Modelo ----------

async function fakeCookieOff(): Promise<boolean> {
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('track_ai_fake')?.value === 'off';
  } catch {
    return false;
  }
}

export async function trackAiFakeActive(): Promise<boolean> {
  if (process.env.TRACK_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return false;
  return !(await fakeCookieOff());
}

/** ¿Hay IA para Track en este request? */
export async function trackAiAvailable(): Promise<boolean> {
  if (await trackAiFakeActive()) return true;
  if (process.env.TRACK_AI_FAKE === '1') return false;
  return aiEnabled();
}

async function pickModel(workspaceId: string, fake: () => string, preferredId?: string | null): Promise<{ model: LanguageModel; modelId: string }> {
  if (await trackAiFakeActive()) {
    await assertAiQuota(workspaceId);
    return { model: fakeModel(() => ({ text: fake() })), modelId: 'track-fake' };
  }
  if (process.env.TRACK_AI_FAKE === '1') throw new AiError('ai_disabled');
  await assertAiAvailable(workspaceId);
  return resolveAiModel(preferredId);
}

export async function trackGenerateObject<T>(opts: {
  workspaceId: string;
  feature: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  fake: () => T;
  modelId?: string | null;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<T> {
  const { model, modelId } = await pickModel(opts.workspaceId, () => JSON.stringify(opts.fake()), opts.modelId);
  const result = await generateText({
    model,
    instructions: opts.instructions,
    prompt: opts.prompt,
    output: Output.object({ schema: opts.schema }),
    maxOutputTokens: opts.maxOutputTokens ?? 900,
    temperature: opts.temperature ?? 0.2,
    timeout: 45_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId: opts.workspaceId,
    feature: opts.feature,
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  return result.output as T;
}

export async function trackGenerateText(opts: {
  workspaceId: string;
  feature: string;
  instructions: string;
  prompt: string;
  fake: () => string;
  maxOutputTokens?: number;
}): Promise<string> {
  const { model, modelId } = await pickModel(opts.workspaceId, opts.fake);
  const result = await generateText({
    model,
    instructions: opts.instructions,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens ?? 700,
    temperature: 0.2,
    timeout: 45_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId: opts.workspaceId,
    feature: opts.feature,
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  return result.text.trim();
}

// ---------- Contexto de un issue ----------

interface IssueCtx {
  id: string;
  project_id: string;
  identifier: string;
  title: string;
  description: string;
  priority: string;
  labels: string;
  assignee_id: string | null;
  triage: number;
  team_id: string | null;
  owner_id: string | null;
  project_name: string;
}

async function issueCtx(issueId: string): Promise<IssueCtx | null> {
  return ((await getDb()
    .prepare(
      `SELECT i.id, i.project_id, i.identifier, i.title, i.description, i.priority, i.labels, i.assignee_id, i.triage,
         p.team_id, p.owner_id, p.name AS project_name
       FROM track_issues i JOIN track_projects p ON p.id = i.project_id WHERE i.id = ?`,
    )
    .get(issueId)) as IssueCtx | undefined) ?? null;
}

export function blocksText(raw: string): string {
  try {
    const blocks = JSON.parse(raw) as Array<{ text?: string }>;
    return Array.isArray(blocks) ? blocks.map((b) => b.text ?? '').join('\n').trim() : '';
  } catch {
    return raw;
  }
}

/** Raíz simple (crashes/crashing → crash, notifications → notification) para comparar títulos. */
function stem(w: string): string {
  for (const suf of ['ing', 'ed', 'es', 's']) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

function words(s: string): Set<string> {
  return new Set(
    s
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'not', 'are', 'los', 'las', 'del', 'con', 'para', 'por', 'que', 'una', 'uno', 'como', 'sin', 'nao', 'com', 'uma', 'issue']);

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / Math.min(a.size, b.size);
}

// ---------- Sugerencias de triage ----------

export interface TriageSuggestion {
  id: string;
  kind: AiSuggestionKind;
  /** assignee: user id; labels: label id; priority: urgent|high|medium|low; duplicate: issue id. */
  value: string;
  label: string;
  reason: string;
  status: 'pending' | 'accepted' | 'dismissed';
}

const suggestionSchema = z.object({
  assignee: z.object({ id: z.string(), reason: z.string() }).nullable(),
  labels: z.array(z.object({ id: z.string(), reason: z.string() })).max(3),
  priority: z.object({ value: z.enum(['urgent', 'high', 'medium', 'low']), reason: z.string() }).nullable(),
  duplicates: z.array(z.object({ identifier: z.string(), reason: z.string() })).max(3),
});
type RawSuggestions = z.infer<typeof suggestionSchema>;

interface Candidates {
  members: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string }>;
  issues: Array<{ id: string; identifier: string; title: string; assignee_id: string | null; labels: string }>;
}

async function candidatesFor(issue: IssueCtx): Promise<Candidates> {
  const db = getDb();
  const ws = projectWorkspaceId(issue) ?? '';
  const { projectMemberIds } = await import('./track-triage');
  const memberIds = [...(await projectMemberIds(issue.project_id))];
  const members = memberIds.length
    ? ((await db
        .prepare(`SELECT id, COALESCE(name, email) AS name FROM users WHERE id IN (${memberIds.map(() => '?').join(', ')})`)
        .all(...memberIds)) as Array<{ id: string; name: string }>)
    : [];
  const labels = (await db.prepare('SELECT id, name FROM track_labels WHERE workspace_id = ? ORDER BY name LIMIT 100').all(ws)) as Array<{
    id: string;
    name: string;
  }>;
  // Issues del workspace (no los de triage): base para duplicados y para quién suele tomar qué.
  const issues = (await db
    .prepare(
      `SELECT i.id, i.identifier, i.title, i.assignee_id, i.labels FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE COALESCE(p.team_id, p.owner_id) = ? AND i.id != ? AND i.triage = 0
       ORDER BY i.updated_at DESC LIMIT 200`,
    )
    .all(ws, issue.id)) as Candidates['issues'];
  return { members, labels, issues };
}

/**
 * Posibles duplicados de un issue (para el picker de "Duplicate" del triage):
 * issues del workspace con más palabras del título en común, sin IA.
 */
export async function duplicateCandidates(
  issueId: string,
  limit = 5,
): Promise<Array<{ id: string; identifier: string; title: string; score: number }>> {
  const issue = await issueCtx(issueId);
  if (!issue) return [];
  const c = await candidatesFor(issue);
  const mine = words(`${issue.title}\n${blocksText(issue.description)}`);
  const titleWords = words(issue.title);
  return c.issues
    .map((i) => {
      const w = words(i.title);
      return { id: i.id, identifier: i.identifier, title: i.title, score: Math.max(similarity(titleWords, w), similarity(mine, w) * 0.8) };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Sugerencias sin modelo (modelo falso de e2e): labels cuyo nombre aparece en
 * el texto, duplicados por palabras en común, el asignado que más tomó issues
 * parecidos y prioridad por palabras como "crash" o "urgent".
 */
export function heuristicSuggestions(issue: { title: string; description: string; priority: string }, c: Candidates): RawSuggestions {
  const text = `${issue.title}\n${issue.description}`;
  const mine = words(text);
  const lower = text.toLowerCase();
  const labels = c.labels.filter((l) => l.name.length > 1 && lower.includes(l.name.toLowerCase())).slice(0, 3);
  const scored = c.issues
    .map((i) => ({ i, s: similarity(mine, words(i.title)) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2);
  const votes = new Map<string, number>();
  for (const i of c.issues) {
    if (!i.assignee_id) continue;
    const s = similarity(mine, words(i.title));
    if (s > 0) votes.set(i.assignee_id, (votes.get(i.assignee_id) ?? 0) + s);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const assignee = best && c.members.some((m) => m.id === best[0]) ? best[0] : null;
  const urgent = /\b(crash|down|outage|urgent|urgente|caido|caida|payment|pago)\b/i.test(lower);
  const high = /\b(bug|error|broken|roto|falla|fails?)\b/i.test(lower);
  const priority = urgent ? 'urgent' : high ? 'high' : null;
  return {
    assignee: assignee ? { id: assignee, reason: 'Took similar issues before.' } : null,
    labels: labels.map((l) => ({ id: l.id, reason: `The text mentions "${l.name}".` })),
    priority: priority && priority !== issue.priority ? { value: priority, reason: 'The report describes a broken flow.' } : null,
    duplicates: scored.map((x) => ({ identifier: x.i.identifier, reason: `Same topic as "${x.i.title}".` })),
  };
}

function parseSuggestions(raw: string | null | undefined): TriageSuggestion[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? (v as TriageSuggestion[]) : [];
  } catch {
    return [];
  }
}

export async function getTriageSuggestions(issueId: string): Promise<{ suggestions: TriageSuggestion[]; generatedAt: string | null }> {
  const row = (await getDb().prepare('SELECT suggestions, suggestions_at FROM track_issue_ai WHERE issue_id = ?').get(issueId)) as
    | { suggestions: string; suggestions_at: string | null }
    | undefined;
  return { suggestions: parseSuggestions(row?.suggestions), generatedAt: row?.suggestions_at ?? null };
}

async function saveSuggestions(issueId: string, list: TriageSuggestion[]): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_issue_ai (issue_id, suggestions, suggestions_at) VALUES (?, ?, ?)
       ON CONFLICT(issue_id) DO UPDATE SET suggestions = excluded.suggestions, suggestions_at = excluded.suggestions_at, claimed_at = NULL`,
    )
    .run(issueId, JSON.stringify(list), new Date().toISOString());
}

/**
 * Pide sugerencias al modelo y las guarda. Con autoApply aplica las de los
 * tipos que el proyecto tiene en "auto". Un claim (claimed_at) evita que dos
 * requests generen a la vez para el mismo issue.
 */
export async function generateTriageSuggestions(
  issueId: string,
  opts: { autoApply?: boolean; actorId?: string } = {},
): Promise<TriageSuggestion[]> {
  const issue = await issueCtx(issueId);
  if (!issue) throw new AiError('ai_disabled');
  const ws = issue.owner_id ?? '';
  const db = getDb();
  const stale = new Date(Date.now() - 2 * 60_000).toISOString();
  await db.prepare('INSERT OR IGNORE INTO track_issue_ai (issue_id) VALUES (?)').run(issueId);
  const claim = await db
    .prepare('UPDATE track_issue_ai SET claimed_at = ? WHERE issue_id = ? AND (claimed_at IS NULL OR claimed_at < ?)')
    .run(new Date().toISOString(), issueId, stale);
  if (!claim.changes) return (await getTriageSuggestions(issueId)).suggestions;
  try {
    const settings = await getTriageSettings(issue.project_id);
    const c = await candidatesFor(issue);
    const description = blocksText(issue.description).slice(0, 3000);
    const prompt = [
      `New issue ${issue.identifier} in project "${issue.project_name}":`,
      `Title: ${issue.title}`,
      `Priority: ${issue.priority}`,
      `Description: ${description || '(empty)'}`,
      '',
      'Team members (id: name):',
      ...c.members.map((m) => `${m.id}: ${m.name}`),
      '',
      'Labels (id: name):',
      ...c.labels.map((l) => `${l.id}: ${l.name}`),
      '',
      'Recent issues (identifier | title | assignee id):',
      ...c.issues.slice(0, 150).map((i) => `${i.identifier} | ${i.title.slice(0, 120)} | ${i.assignee_id ?? '-'}`),
    ].join('\n');
    const raw = await trackGenerateObject({
      workspaceId: ws,
      feature: 'track_triage_ai',
      instructions:
        'You triage issues for a software team. Suggest who should take the issue (from the members, based on who handled similar issues), up to three labels from the list, a priority only if the current one looks wrong, and existing issues that look like duplicates (only with strong similarity). Use only ids and identifiers from the lists. Keep each reason under 15 words. Return null or an empty list when unsure.',
      prompt,
      schema: suggestionSchema,
      fake: () => heuristicSuggestions({ title: issue.title, description, priority: issue.priority }, c),
    });
    const currentLabels = new Set(parseIssueLabels(issue.labels).map((l) => l.id));
    const list: TriageSuggestion[] = [];
    const mk = (kind: AiSuggestionKind, value: string, label: string, reason: string) =>
      list.push({ id: crypto.randomUUID().slice(0, 12), kind, value, label, reason: reason.slice(0, 200), status: 'pending' });
    if (settings.aiModes.assignee !== 'off' && raw.assignee && raw.assignee.id !== issue.assignee_id) {
      const m = c.members.find((x) => x.id === raw.assignee!.id);
      if (m) mk('assignee', m.id, m.name, raw.assignee.reason);
    }
    if (settings.aiModes.labels !== 'off') {
      for (const l of raw.labels) {
        const found = c.labels.find((x) => x.id === l.id);
        if (found && !currentLabels.has(found.id) && !list.some((s) => s.kind === 'labels' && s.value === found.id)) mk('labels', found.id, found.name, l.reason);
      }
    }
    if (settings.aiModes.priority !== 'off' && raw.priority && raw.priority.value !== issue.priority) {
      mk('priority', raw.priority.value, raw.priority.value, raw.priority.reason);
    }
    if (settings.aiModes.duplicate !== 'off') {
      for (const d of raw.duplicates) {
        const found = c.issues.find((x) => x.identifier.toUpperCase() === d.identifier.trim().toUpperCase());
        if (found && !list.some((s) => s.kind === 'duplicate' && s.value === found.id)) mk('duplicate', found.id, `${found.identifier} ${found.title}`.slice(0, 160), d.reason);
      }
    }
    await saveSuggestions(issueId, list);
    if (opts.autoApply) {
      for (const s of list) {
        if (settings.aiModes[s.kind] === 'auto' && s.kind !== 'duplicate') {
          await decideSuggestion(issueId, s.id, 'accept', opts.actorId ?? ws).catch(() => undefined);
        }
      }
    }
    return (await getTriageSuggestions(issueId)).suggestions;
  } catch (err) {
    await db.prepare('UPDATE track_issue_ai SET claimed_at = NULL WHERE issue_id = ?').run(issueId);
    throw err;
  }
}

/** Acepta (aplica) o descarta una sugerencia. */
export async function decideSuggestion(
  issueId: string,
  suggestionId: string,
  decision: 'accept' | 'dismiss',
  actorId: string,
): Promise<TriageSuggestion[]> {
  const { suggestions } = await getTriageSuggestions(issueId);
  const s = suggestions.find((x) => x.id === suggestionId);
  if (!s || s.status !== 'pending') return suggestions;
  if (decision === 'accept') {
    const { getIssue, updateIssue, createIssueRelation } = await import('./track-data');
    const issue = await getIssue(issueId);
    if (!issue) return suggestions;
    const via = { source: 'triage' as const, author: 'Triage AI' };
    if (s.kind === 'assignee') await updateIssue(issueId, { assigneeId: s.value }, actorId, { via });
    else if (s.kind === 'priority') await updateIssue(issueId, { priority: s.value as 'urgent' | 'high' | 'medium' | 'low' }, actorId, { via });
    else if (s.kind === 'labels') {
      const current = parseIssueLabels(issue.labels).map((l) => ({ id: l.id }));
      if (!current.some((l) => l.id === s.value)) await updateIssue(issueId, { labels: [...current, { id: s.value }].slice(0, 10) }, actorId, { via });
    } else if (s.kind === 'duplicate') {
      if (issue.triage === 1) {
        const { resolveTriage } = await import('./track-bulk');
        const res = await resolveTriage(issue, { action: 'duplicate', duplicateOfId: s.value }, actorId);
        if (res.ok) await (await import('./track-customers')).moveRequests(issueId, s.value);
      } else {
        await createIssueRelation(issueId, actorId, s.value, 'duplicates').catch(() => undefined);
      }
    }
  }
  const next = suggestions.map((x) => (x.id === suggestionId ? { ...x, status: decision === 'accept' ? ('accepted' as const) : ('dismissed' as const) } : x));
  await getDb().prepare('UPDATE track_issue_ai SET suggestions = ? WHERE issue_id = ?').run(JSON.stringify(next), issueId);
  return next;
}

// ---------- Resúmenes ----------

export async function getIssueSummary(issueId: string): Promise<{ summary: string; generatedAt: string | null }> {
  const row = (await getDb().prepare('SELECT summary, summary_at FROM track_issue_ai WHERE issue_id = ?').get(issueId)) as
    | { summary: string; summary_at: string | null }
    | undefined;
  return { summary: row?.summary ?? '', generatedAt: row?.summary_at ?? null };
}

/** Resumen del issue y de su discusión (descripción, comentarios y cambios). */
export async function summarizeIssue(issueId: string, locale = 'en'): Promise<{ summary: string; generatedAt: string }> {
  const issue = await issueCtx(issueId);
  if (!issue) throw new AiError('ai_disabled');
  const db = getDb();
  const comments = (await db
    .prepare(
      `SELECT c.body, c.created_at, COALESCE(u.name, u.email) AS author FROM track_issue_comments c JOIN users u ON u.id = c.user_id
       WHERE c.issue_id = ? ORDER BY c.created_at ASC LIMIT 200`,
    )
    .all(issueId)) as Array<{ body: string; created_at: string; author: string }>;
  const requests = (await db
    .prepare('SELECT customer_name, customer_email, body FROM track_customer_requests WHERE issue_id = ? LIMIT 30')
    .all(issueId)) as Array<{ customer_name: string; customer_email: string; body: string }>;
  const description = blocksText(issue.description);
  const lines = [
    `Issue ${issue.identifier}: ${issue.title}`,
    `Description: ${description.slice(0, 4000) || '(empty)'}`,
    '',
    'Comments (oldest first):',
    ...comments.map((c) => `[${c.created_at.slice(0, 16).replace('T', ' ')}] ${c.author}: ${c.body.replace(/\s+/g, ' ').slice(0, 800)}`),
    ...(requests.length ? ['', 'Customer requests:', ...requests.map((r) => `- ${r.customer_name || r.customer_email}: ${r.body.slice(0, 300)}`)] : []),
  ];
  const fake = () => {
    const last = comments[comments.length - 1];
    return [
      `${issue.title}.`,
      description ? description.split('\n')[0].slice(0, 160) : '',
      comments.length ? `${comments.length} comment${comments.length === 1 ? '' : 's'}; latest from ${last.author}: ${last.body.replace(/\s+/g, ' ').slice(0, 120)}` : 'No discussion yet.',
    ]
      .filter(Boolean)
      .join('\n');
  };
  const summary = await trackGenerateText({
    workspaceId: issue.owner_id ?? '',
    feature: 'track_issue_summary',
    instructions: `Summarize this issue for a teammate who has not read it, in ${LOCALE_NAME[locale] ?? 'English'}. At most 5 short lines in plain text: what the problem is, what was decided or tried, and what is still open. Only use what is in the text.`,
    prompt: lines.join('\n'),
    fake,
    maxOutputTokens: 400,
  });
  const at = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO track_issue_ai (issue_id, summary, summary_at) VALUES (?, ?, ?)
       ON CONFLICT(issue_id) DO UPDATE SET summary = excluded.summary, summary_at = excluded.summary_at`,
    )
    .run(issueId, summary.slice(0, 4000), at);
  return { summary, generatedAt: at };
}

/**
 * Borrador del update de un proyecto: lo que se cerró, lo que avanzó, lo que
 * está bloqueado o vencido en los últimos `days` días.
 */
export async function summarizeProject(projectId: string, locale = 'en', days = 14): Promise<string> {
  const db = getDb();
  const project = (await db.prepare('SELECT id, name, owner_id FROM track_projects WHERE id = ?').get(projectId)) as
    | { id: string; name: string; owner_id: string | null }
    | undefined;
  if (!project) throw new AiError('ai_disabled');
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const issues = (await db
    .prepare(
      `SELECT i.identifier, i.title, i.priority, i.due_date, i.updated_at, s.category, s.name AS status
       FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.project_id = ? AND i.triage = 0 AND (i.updated_at >= ? OR s.category IN ('in_progress'))
       ORDER BY i.updated_at DESC LIMIT 200`,
    )
    .all(projectId, since)) as Array<{ identifier: string; title: string; priority: string; due_date: string | null; category: string | null; status: string | null }>;
  const today = new Date().toISOString().slice(0, 10);
  const done = issues.filter((i) => i.category === 'done');
  const doing = issues.filter((i) => i.category === 'in_progress');
  const late = issues.filter((i) => i.due_date && i.due_date < today && i.category !== 'done' && i.category !== 'cancelled');
  const fmt = (i: (typeof issues)[number]) => `${i.identifier} ${i.title} [${i.status ?? '-'}, ${i.priority}${i.due_date ? `, due ${i.due_date}` : ''}]`;
  const fake = () =>
    [
      `${project.name}: ${done.length} done, ${doing.length} in progress, ${late.length} overdue in the last ${days} days.`,
      done.length ? `Done: ${done.slice(0, 5).map((i) => i.identifier).join(', ')}.` : '',
      late.length ? `Overdue: ${late.slice(0, 5).map((i) => i.identifier).join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  return trackGenerateText({
    workspaceId: project.owner_id ?? '',
    feature: 'track_project_summary',
    instructions: `Write a short project update for stakeholders in ${LOCALE_NAME[locale] ?? 'English'}, plain text, at most 8 lines: what shipped, what is in progress, what is at risk (overdue). Mention issue identifiers. Only use the data given.`,
    prompt: [
      `Project "${project.name}", last ${days} days.`,
      'Done:',
      ...done.map(fmt),
      'In progress:',
      ...doing.map(fmt),
      'Overdue:',
      ...late.map(fmt),
    ].join('\n'),
    fake,
    maxOutputTokens: 500,
  });
}

// ---------- Issue desde texto libre ----------

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  labelIds: z.array(z.string()).max(3),
});
export type IssueDraft = z.infer<typeof draftSchema>;

export async function issueFromText(projectId: string, text: string, locale = 'en'): Promise<IssueDraft> {
  const db = getDb();
  const project = (await db.prepare('SELECT id, name, team_id, owner_id FROM track_projects WHERE id = ?').get(projectId)) as
    | { id: string; name: string; team_id: string | null; owner_id: string | null }
    | undefined;
  if (!project) throw new AiError('ai_disabled');
  const labels = (await db.prepare('SELECT id, name FROM track_labels WHERE workspace_id = ? ORDER BY name LIMIT 100').all(projectWorkspaceId(project) ?? '')) as Array<{
    id: string;
    name: string;
  }>;
  const clean = text.trim().slice(0, 6000);
  const fake = (): IssueDraft => {
    const first = clean.split(/\n|(?<=[.!?])\s/)[0]?.trim() || clean;
    const lower = clean.toLowerCase();
    return {
      title: first.slice(0, 80),
      description: clean,
      priority: /\b(urgent|urgente|crash|down|caido)\b/i.test(lower) ? 'urgent' : /\b(bug|error|broken|roto|falla)\b/i.test(lower) ? 'high' : 'medium',
      labelIds: labels.filter((l) => lower.includes(l.name.toLowerCase())).map((l) => l.id).slice(0, 3),
    };
  };
  const draft = await trackGenerateObject({
    workspaceId: project.owner_id ?? '',
    feature: 'track_issue_from_text',
    instructions: `Turn the text (a message, a customer email or notes) into one issue for a software team, in ${LOCALE_NAME[locale] ?? 'English'}. Title: short and specific, imperative or descriptive, no trailing period. Description: the relevant facts in Markdown (steps, expected vs actual) without inventing anything. Priority from the impact described. Up to three labels, only ids from the list.`,
    prompt: [`Labels (id: name):`, ...labels.map((l) => `${l.id}: ${l.name}`), '', 'Text:', clean].join('\n'),
    schema: draftSchema,
    fake,
  });
  return { ...draft, labelIds: draft.labelIds.filter((id) => labels.some((l) => l.id === id)) };
}
