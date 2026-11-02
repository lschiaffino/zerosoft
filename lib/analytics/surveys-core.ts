/**
 * Encuestas, la parte pura: estado efectivo, plantillas y resultados. Las
 * respuestas las manda el navegador del visitante, así que todo se valida al
 * leer: un puntaje fuera de escala, una opción que no existe o un tipo raro no
 * cuentan, y los textos se recortan. Sin base: lo prueban los tests.
 */
import {
  SURVEY_TEXT_CAP,
  surveyAppearanceSchema,
  surveyQuestionSchema,
  surveyTargetingSchema,
  type SurveyAppearance,
  type SurveyDto,
  type SurveyQuestion,
  type SurveyQuestionResult,
  type SurveyTargeting,
} from './more-types';

export const defaultAppearance = (): SurveyAppearance => surveyAppearanceSchema.parse({});
export const defaultTargeting = (): SurveyTargeting => surveyTargetingSchema.parse({});

function parseJson(raw: unknown): unknown {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** JSON guardado → preguntas válidas (lo que no pasa el esquema no llega ni a la UI ni al snippet). */
export function parseQuestions(raw: unknown): SurveyQuestion[] {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  const out: SurveyQuestion[] = [];
  for (const q of list) {
    const r = surveyQuestionSchema.safeParse(q);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function parseAppearance(raw: unknown): SurveyAppearance {
  const r = surveyAppearanceSchema.safeParse(parseJson(raw));
  return r.success ? r.data : defaultAppearance();
}

export function parseTargeting(raw: unknown): SurveyTargeting {
  const r = surveyTargetingSchema.safeParse(parseJson(raw));
  return r.success ? r.data : defaultTargeting();
}

/** Estado para mostrar: "running" con fecha de fin vencida ya terminó; con inicio futuro, está programada. */
export type SurveyDisplayStatus = SurveyDto['status'] | 'scheduled';

export function surveyDisplayStatus(s: Pick<SurveyDto, 'status' | 'startAt' | 'endAt'>, now: number): SurveyDisplayStatus {
  if (s.status !== 'running') return s.status;
  if (s.endAt !== null && s.endAt <= now) return 'ended';
  if (s.startAt !== null && s.startAt > now) return 'scheduled';
  return 'running';
}

/** ¿Se le muestra a los visitantes ahora? */
export function surveyIsLive(s: Pick<SurveyDto, 'status' | 'startAt' | 'endAt'>, now: number): boolean {
  return surveyDisplayStatus(s, now) === 'running';
}

/** Día 'YYYY-MM-DD' en la zona del proyecto → ms (comienzo o fin de ese día). */
export function dayToMs(day: string, offsetMin: number, edge: 'start' | 'end'): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return t - offsetMin * 60_000 + (edge === 'end' ? 86_400_000 - 1 : 0);
}

export function msToDay(ms: number | null, offsetMin: number): string {
  if (ms === null) return '';
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);
}

export interface SurveyEventRow {
  ts: number;
  distinctId: string;
  properties: Record<string, unknown>;
}

/** Valor crudo de una pregunta: `$survey_response_<id>`, o `$survey_response` para la primera (eventos estilo PostHog). */
export function rawAnswer(props: Record<string, unknown>, q: SurveyQuestion, index: number): unknown {
  const own = props[`$survey_response_${q.id}`];
  if (own !== undefined && own !== null) return own;
  return index === 0 ? props.$survey_response : undefined;
}

export type CleanAnswer = { kind: 'none' } | { kind: 'invalid' } | { kind: 'rating'; value: number } | { kind: 'choices'; values: string[] } | { kind: 'text'; value: string };

/** Una respuesta del cliente contra la pregunta. Solo pasa lo que la pregunta permite. */
export function cleanAnswer(q: SurveyQuestion, raw: unknown): CleanAnswer {
  if (raw === undefined || raw === null || raw === '') return { kind: 'none' };
  if (q.type === 'rating') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,2}$/.test(raw.trim()) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < ratingMin(q.scale) || n > q.scale) return { kind: 'invalid' };
    return { kind: 'rating', value: n };
  }
  if (q.type === 'open') {
    if (typeof raw !== 'string' && typeof raw !== 'number') return { kind: 'invalid' };
    const text = String(raw).trim().slice(0, SURVEY_TEXT_CAP);
    return text ? { kind: 'text', value: text } : { kind: 'none' };
  }
  const list = Array.isArray(raw) ? raw : [raw];
  if (q.type === 'single' && list.length !== 1) return { kind: 'invalid' };
  if (list.length > q.choices.length) return { kind: 'invalid' };
  const values: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string' || !q.choices.includes(v)) return { kind: 'invalid' };
    if (!values.includes(v)) values.push(v);
  }
  return values.length ? { kind: 'choices', values } : { kind: 'none' };
}

/** La escala de 10 es la de NPS y arranca en 0; la de 5 arranca en 1. */
export function ratingMin(scale: number): number {
  return scale === 10 ? 0 : 1;
}

/** NPS con escala de 0 a 10: promotores 9 y 10, neutros 7 y 8, detractores de 0 a 6. */
export function npsFrom(distribution: number[]): { nps: number | null; promoters: number; passives: number; detractors: number } {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  distribution.forEach((count, i) => {
    const score = i;
    if (score >= 9) promoters += count;
    else if (score >= 7) passives += count;
    else detractors += count;
  });
  const total = promoters + passives + detractors;
  return { nps: total ? Math.round(((promoters - detractors) / total) * 100) : null, promoters, passives, detractors };
}

const MAX_OPEN_ANSWERS = 500;

/** Resultados por pregunta a partir de las filas de `survey sent` (más nuevas primero). */
export function computeQuestionResults(questions: SurveyQuestion[], rows: SurveyEventRow[]): SurveyQuestionResult[] {
  return questions.map((q, index): SurveyQuestionResult => {
    let answered = 0;
    let invalid = 0;
    if (q.type === 'rating') {
      const min = ratingMin(q.scale);
      const distribution = Array.from({ length: q.scale - min + 1 }, () => 0);
      let sum = 0;
      for (const r of rows) {
        const a = cleanAnswer(q, rawAnswer(r.properties, q, index));
        if (a.kind === 'invalid') invalid++;
        if (a.kind !== 'rating') continue;
        answered++;
        sum += a.value;
        distribution[a.value - min]++;
      }
      const nps = q.scale === 10 ? npsFrom(distribution) : { nps: null, promoters: 0, passives: 0, detractors: 0 };
      return { id: q.id, type: 'rating', text: q.text, answered, invalid, scale: q.scale, distribution, average: answered ? sum / answered : null, ...nps };
    }
    if (q.type === 'open') {
      const answers: Array<{ ts: number; distinctId: string; text: string }> = [];
      for (const r of rows) {
        const a = cleanAnswer(q, rawAnswer(r.properties, q, index));
        if (a.kind === 'invalid') invalid++;
        if (a.kind !== 'text') continue;
        answered++;
        if (answers.length < MAX_OPEN_ANSWERS) answers.push({ ts: r.ts, distinctId: r.distinctId, text: a.value });
      }
      return { id: q.id, type: 'open', text: q.text, answered, invalid, answers };
    }
    const counts = new Map(q.choices.map((c) => [c, 0]));
    for (const r of rows) {
      const a = cleanAnswer(q, rawAnswer(r.properties, q, index));
      if (a.kind === 'invalid') invalid++;
      if (a.kind !== 'choices') continue;
      answered++;
      for (const v of a.values) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return { id: q.id, type: q.type, text: q.text, answered, invalid, choices: q.choices.map((label) => ({ label, count: counts.get(label) ?? 0 })) };
  });
}

/** Una fila del CSV: fecha, distinct_id y una columna por pregunta con el valor ya validado. */
export function surveyCsvRow(questions: SurveyQuestion[], row: SurveyEventRow): Array<string | number> {
  const cells: Array<string | number> = [new Date(row.ts).toISOString(), row.distinctId.slice(0, 200)];
  questions.forEach((q, index) => {
    const a = cleanAnswer(q, rawAnswer(row.properties, q, index));
    if (a.kind === 'rating') cells.push(a.value);
    else if (a.kind === 'text') cells.push(a.value);
    else if (a.kind === 'choices') cells.push(a.values.join('; '));
    else cells.push('');
  });
  return cells;
}
