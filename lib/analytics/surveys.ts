/**
 * Encuestas de Analytics: registros por proyecto, lo que ve el sitio del
 * cliente (lista activa con caché corta) y los resultados, que salen de
 * analytics_events con filas acotadas. Server-only.
 */
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import { resolveRange } from './compute';
import { decideFlags, personPropsFor } from './flags';
import { flagHash, matchProperty } from './flags-core';
import type { ProjectRow } from './projects';
import {
  surveyPatchSchema,
  type PublicSurvey,
  type SurveyDto,
  type SurveyListItem,
  type SurveyPatch,
  type SurveyQuestion,
  type SurveyResults,
} from './more-types';
import { computeQuestionResults, defaultAppearance, defaultTargeting, parseAppearance, parseQuestions, parseTargeting, surveyIsLive, type SurveyEventRow } from './surveys-core';

/** Filas de eventos que mira una lectura como mucho. */
export const SURVEY_ROW_CAP = 20_000;
const SCAN_CAP = 200_000;

const SURVEY_ID = `json_extract(properties, '$."$survey_id"')`;

interface SurveyRow {
  id: string;
  project_id: string;
  name: string;
  status: string;
  presentation: string;
  questions: string;
  appearance: string;
  targeting: string;
  start_at: number | null;
  end_at: number | null;
  created_at: string;
  updated_at: string;
}

function toDto(r: SurveyRow): SurveyDto {
  return {
    id: r.id,
    name: r.name,
    status: (['draft', 'running', 'paused', 'ended'].includes(r.status) ? r.status : 'draft') as SurveyDto['status'],
    presentation: r.presentation === 'api' ? 'api' : 'popover',
    questions: parseQuestions(r.questions),
    appearance: parseAppearance(r.appearance),
    targeting: parseTargeting(r.targeting),
    startAt: r.start_at === null ? null : Number(r.start_at),
    endAt: r.end_at === null ? null : Number(r.end_at),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const nowIso = () => new Date().toISOString();

export async function listSurveys(projectId: string): Promise<SurveyListItem[]> {
  const [rows, counts] = await Promise.all([
    getDb().prepare('SELECT * FROM analytics_surveys WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500').all(projectId) as Promise<unknown> as Promise<SurveyRow[]>,
    // Respuestas de cada encuesta: las últimas SCAN_CAP de todo el proyecto.
    getDb()
      .prepare(
        `SELECT ${SURVEY_ID} AS sid, COUNT(*) AS n FROM (
           SELECT properties FROM analytics_events WHERE project_id = ? AND event = 'survey sent' ORDER BY ts DESC LIMIT ${SCAN_CAP}
         ) GROUP BY sid`,
      )
      .all(projectId) as Promise<unknown> as Promise<Array<{ sid: unknown; n: number }>>,
  ]);
  const byId = new Map(counts.map((c) => [String(c.sid), Number(c.n)]));
  return rows.map((r) => ({ ...toDto(r), responses: byId.get(r.id) ?? 0 }));
}

export async function getSurvey(projectId: string, id: string): Promise<SurveyDto | null> {
  const r = (await getDb().prepare('SELECT * FROM analytics_surveys WHERE id = ? AND project_id = ?').get(id, projectId)) as SurveyRow | undefined;
  return r ? toDto(r) : null;
}

/** Pregunta inicial de una encuesta nueva (NPS). El texto lo manda la UI en el idioma de quien la crea. */
export function starterQuestion(text: string, lowLabel = '', highLabel = ''): SurveyQuestion {
  return { id: `q_${nanoid(8)}`, type: 'rating', text: text.trim().slice(0, 500) || 'How likely are you to recommend us?', description: '', scale: 10, lowLabel, highLabel, choices: [], optional: false };
}

export async function createSurvey(projectId: string, personId: string, input: { name: string; question?: SurveyQuestion }): Promise<SurveyDto> {
  const id = `asv_${nanoid(12)}`;
  const ts = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO analytics_surveys (id, project_id, name, status, presentation, questions, appearance, targeting, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 'popover', ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, input.name.trim().slice(0, 200) || 'Survey', JSON.stringify([input.question ?? starterQuestion('')]), JSON.stringify(defaultAppearance()), JSON.stringify(defaultTargeting()), personId, ts, ts);
  forgetSurveysCache(projectId);
  return (await getSurvey(projectId, id))!;
}

export async function updateSurvey(projectId: string, id: string, patch: SurveyPatch): Promise<SurveyDto | null> {
  const clean = surveyPatchSchema.parse(patch);
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const put = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (clean.name !== undefined) put('name', clean.name);
  if (clean.status !== undefined) put('status', clean.status);
  if (clean.presentation !== undefined) put('presentation', clean.presentation);
  if (clean.questions !== undefined) put('questions', JSON.stringify(clean.questions));
  if (clean.appearance !== undefined) put('appearance', JSON.stringify(clean.appearance));
  if (clean.targeting !== undefined) put('targeting', JSON.stringify(clean.targeting));
  if (clean.startAt !== undefined) put('start_at', clean.startAt);
  if (clean.endAt !== undefined) put('end_at', clean.endAt);
  if (sets.length) {
    put('updated_at', nowIso());
    await getDb()
      .prepare(`UPDATE analytics_surveys SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`)
      .run(...args, id, projectId);
  }
  forgetSurveysCache(projectId);
  return getSurvey(projectId, id);
}

export async function deleteSurvey(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_surveys WHERE id = ? AND project_id = ?').run(id, projectId);
  forgetSurveysCache(projectId);
  return res.changes > 0;
}

// ---------- Lo que ve el sitio del cliente ----------

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; surveys: SurveyDto[] }>();

export function forgetSurveysCache(projectId?: string): void {
  if (projectId) cache.delete(projectId);
  else cache.clear();
}

async function runningSurveys(projectId: string): Promise<SurveyDto[]> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.surveys;
  const rows = (await getDb()
    .prepare(`SELECT * FROM analytics_surveys WHERE project_id = ? AND status = 'running' ORDER BY created_at LIMIT 50`)
    .all(projectId)) as unknown as SurveyRow[];
  const surveys = rows.map(toDto).filter((s) => s.questions.length > 0);
  if (cache.size > 2000) cache.clear();
  cache.set(projectId, { at: Date.now(), surveys });
  return surveys;
}

/** ¿Hay una encuesta popover al aire? Va en la config de /decide: sin esto el snippet no pide nada más. */
export async function hasLivePopover(projectId: string, now = Date.now()): Promise<boolean> {
  return (await runningSurveys(projectId)).some((s) => s.presentation === 'popover' && surveyIsLive(s, now));
}

/**
 * Encuestas al aire para un distinct_id. Muestreo, flag y propiedad de la
 * persona se resuelven acá: el sitio solo recibe lo que le toca, sin las
 * condiciones.
 */
export async function surveysFor(projectId: string, distinctId: string, now = Date.now()): Promise<PublicSurvey[]> {
  const live = (await runningSurveys(projectId)).filter((s) => surveyIsLive(s, now));
  if (!live.length) return [];
  const needFlags = live.some((s) => s.targeting.flagKey);
  const needProps = live.some((s) => s.targeting.personFilter);
  const [flags, props] = await Promise.all([
    needFlags && distinctId ? decideFlags(projectId, distinctId) : Promise.resolve({} as Record<string, boolean | string>),
    needProps && distinctId ? personPropsFor(projectId, distinctId) : Promise.resolve({} as Record<string, unknown>),
  ]);
  const out: PublicSurvey[] = [];
  for (const s of live) {
    const t = s.targeting;
    if (t.sampling < 100 && flagHash(s.id, distinctId, 'survey') >= t.sampling / 100) continue;
    if (t.flagKey && !flags[t.flagKey]) continue;
    if (t.personFilter && !matchProperty(t.personFilter, props)) continue;
    out.push({ id: s.id, type: s.presentation, questions: s.questions, appearance: s.appearance, urlContains: t.urlContains, showOnce: t.showOnce, delaySeconds: t.delaySeconds });
  }
  return out;
}

// ---------- Resultados ----------

function parseProps(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Filas de `survey sent` de la encuesta (las más nuevas, hasta `cap`). `truncated` si había más. */
export async function surveySentRows(project: ProjectRow, surveyId: string, range: { from: number; to: number }, cap = SURVEY_ROW_CAP): Promise<{ rows: SurveyEventRow[]; truncated: boolean }> {
  const raw = (await getDb()
    .prepare(
      `SELECT ts, distinct_id, properties FROM (
         SELECT ts, distinct_id, properties FROM analytics_events
         WHERE project_id = ? AND event = 'survey sent' AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT ${SCAN_CAP}
       ) WHERE ${SURVEY_ID} = ? LIMIT ?`,
    )
    .all(project.id, range.from, range.to, surveyId, cap + 1)) as Array<{ ts: number; distinct_id: string; properties: string }>;
  return {
    rows: raw.slice(0, cap).map((r) => ({ ts: Number(r.ts), distinctId: String(r.distinct_id), properties: parseProps(r.properties) })),
    truncated: raw.length > cap,
  };
}

async function countEvent(project: ProjectRow, event: string, surveyId: string, range: { from: number; to: number }): Promise<number> {
  const r = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT properties FROM analytics_events WHERE project_id = ? AND event = ? AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT ${SCAN_CAP}
       ) WHERE ${SURVEY_ID} = ?`,
    )
    .get(project.id, event, range.from, range.to, surveyId)) as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

export async function surveyResults(project: ProjectRow, survey: SurveyDto, dateRange: { from: string }, now = Date.now()): Promise<SurveyResults> {
  const range = resolveRange(dateRange, now, Number(project.tz_offset_min));
  const [shown, dismissed, sent, data] = await Promise.all([
    countEvent(project, 'survey shown', survey.id, range),
    countEvent(project, 'survey dismissed', survey.id, range),
    countEvent(project, 'survey sent', survey.id, range),
    surveySentRows(project, survey.id, range),
  ]);
  return { shown, dismissed, sent, questions: computeQuestionResults(survey.questions, data.rows), truncated: data.truncated };
}
