/**
 * Calls: IA sobre las llamadas, todo por lib/ai.ts (cuota, rate limit y
 * ai_usage del workspace). Server-only.
 * - Análisis de una llamada: resumen, próximos pasos, temas, preguntas,
 *   objeciones, competidores, scorecard de la metodología y riesgos.
 * - "Preguntale a la llamada" y "preguntale a todas tus llamadas".
 *
 * CALLS_AI_FAKE=1 (tests, nunca en producción): sin modelo, respuestas
 * armadas a partir de la transcripción, siempre iguales.
 */
import { z } from 'zod';
import { aiGenerateObject, aiGenerateText } from '../ai';
import { criteriaFor } from './methodology';
import { findMentions, transcriptLines } from './metrics';
import { CallsError, economyAnalysisModel, nowIso, type CallAnalysis, type CallsSettings, type Speaker, type Utterance } from './types';

export function callsAiFake(): boolean {
  return process.env.CALLS_AI_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

const MAX_TRANSCRIPT_CHARS = 120_000;

function transcriptForModel(utterances: Utterance[], speakers: Speaker[]): string {
  const lines = transcriptLines(utterances, speakers, { sideLabels: { internal: 'our team', external: 'customer' } });
  let out = lines.join('\n');
  if (out.length > MAX_TRANSCRIPT_CHARS) {
    // Principio y final: ahí suelen estar el contexto y los próximos pasos.
    const half = MAX_TRANSCRIPT_CHARS / 2;
    out = `${out.slice(0, half)}\n[...]\n${out.slice(-half)}`;
  }
  return out;
}

const LANG: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

const analysisSchema = z.object({
  summary: z.string(),
  nextSteps: z.array(z.object({ text: z.string(), owner: z.string(), due: z.string() })),
  topics: z.array(z.object({ name: z.string(), startSecond: z.number() })),
  questions: z.array(z.object({ text: z.string(), speaker: z.string(), atSecond: z.number() })),
  objections: z.array(z.object({ text: z.string(), speaker: z.string(), atSecond: z.number(), response: z.string() })),
  competitors: z.array(z.object({ name: z.string(), atSecond: z.number(), quote: z.string() })),
  scorecard: z.array(z.object({ key: z.string(), score: z.number(), evidence: z.string(), atSecond: z.number().nullable() })),
  risks: z.array(z.string()),
});

export async function analyzeCall(opts: {
  ws: string;
  title: string;
  utterances: Utterance[];
  speakers: Speaker[];
  settings: CallsSettings;
  language: string;
}): Promise<CallAnalysis> {
  const criteria = criteriaFor(opts.settings.methodology, opts.settings.customCriteria);
  const byKey = new Map(criteria.map((c) => [c.key, c]));
  const known = findMentions(opts.utterances, opts.settings.competitors);
  if (!opts.utterances.length) throw new CallsError('empty_transcript', 422);
  if (callsAiFake()) return fakeAnalysis(opts, criteria, known);

  const lang = LANG[opts.language.slice(0, 2)] ?? 'the language of the conversation';
  const instructions = [
    'You analyze recorded B2B sales calls for the sales team, like Gong does.',
    'Work only from the transcript. Never invent facts, names, numbers or dates that are not in it.',
    `Write every text field in ${lang}.`,
    'Times are seconds from the start of the recording; take them from the [m:ss] marks.',
    'summary: 3 to 6 sentences: who met, what the customer needs, what was agreed.',
    'nextSteps: concrete commitments with owner (a name from the call or "" if unclear) and due ("" if none was said).',
    'topics: 3 to 8 main topics in order, with the second where each starts.',
    'questions: questions our team asked the customer (discovery), most relevant first, up to 15.',
    'objections: concerns or pushback from the customer (price, timing, fit, security, competitor), with how our team answered ("" if not answered).',
    'competitors: other vendors or tools the customer mentions as alternatives or current solutions.',
    `scorecard: rate each criterion from 0 (not covered) to 5 (fully covered) with one sentence of evidence and the second where it shows (null if absent). Criteria: ${criteria.map((c) => `${c.key} = ${c.name}: ${c.guide}`).join(' | ')}`,
    'risks: short deal risks you see (for example: no next step, decision maker absent, budget unclear, competitor preferred). Empty if none.',
  ].join('\n');
  const res = await aiGenerateObject({
    workspaceId: opts.ws,
    feature: 'calls_analysis',
    instructions,
    prompt: `Call title: ${opts.title || '(none)'}\n\nTranscript:\n${transcriptForModel(opts.utterances, opts.speakers)}`,
    schema: analysisSchema,
    schemaName: 'call_analysis',
    model: opts.settings.costTier === 'economy' ? economyAnalysisModel() : null,
    maxOutputTokens: 4000,
    timeoutMs: 120_000,
  });
  const o = res.object;
  const ms = (s: number | null) => (s === null || !Number.isFinite(s) ? null : Math.max(0, Math.round(s * 1000)));
  const items = criteria.map((c) => {
    const hit = o.scorecard.find((x) => x.key === c.key);
    return { key: c.key, label: c.name, score: Math.max(0, Math.min(5, Math.round(hit?.score ?? 0))), evidence: (hit?.evidence ?? '').slice(0, 400), atMs: ms(hit?.atSecond ?? null) };
  });
  const competitors = mergeCompetitors(
    known,
    o.competitors.map((c) => ({ name: c.name.slice(0, 80), atMs: ms(c.atSecond) ?? 0, quote: c.quote.slice(0, 240) })),
  );
  return {
    summary: o.summary.slice(0, 3000),
    nextSteps: o.nextSteps.slice(0, 20).map((n) => ({ text: n.text.slice(0, 400), owner: n.owner.slice(0, 120), due: n.due.slice(0, 60) })),
    topics: o.topics.slice(0, 12).map((t) => ({ name: t.name.slice(0, 120), startMs: ms(t.startSecond) ?? 0 })),
    questions: o.questions.slice(0, 30).map((q) => ({ text: q.text.slice(0, 400), speaker: q.speaker.slice(0, 120), atMs: ms(q.atSecond) ?? 0 })),
    objections: o.objections.slice(0, 20).map((q) => ({ text: q.text.slice(0, 400), speaker: q.speaker.slice(0, 120), atMs: ms(q.atSecond) ?? 0, response: q.response.slice(0, 400) })),
    competitors,
    scorecard: { methodology: opts.settings.methodology, items: items.filter((i) => byKey.has(i.key)), total: scoreTotal(items) },
    risks: o.risks.slice(0, 8).map((r) => r.slice(0, 200)),
    model: res.model,
    generatedAt: nowIso(),
  };
}

function scoreTotal(items: Array<{ score: number }>): number {
  if (!items.length) return 0;
  return Math.round((items.reduce((s, i) => s + i.score, 0) / (items.length * 5)) * 100);
}

function mergeCompetitors(known: CallAnalysis['competitors'], found: CallAnalysis['competitors']): CallAnalysis['competitors'] {
  const out = [...known];
  for (const f of found) if (!out.some((k) => k.name.toLowerCase() === f.name.toLowerCase() && Math.abs(k.atMs - f.atMs) < 15_000)) out.push(f);
  return out.sort((a, b) => a.atMs - b.atMs).slice(0, 50);
}

/** Análisis fijo para los tests: sale de la transcripción con reglas simples. */
function fakeAnalysis(
  opts: { utterances: Utterance[]; speakers: Speaker[]; settings: CallsSettings },
  criteria: ReturnType<typeof criteriaFor>,
  known: CallAnalysis['competitors'],
): CallAnalysis {
  const names = new Map(opts.speakers.map((s) => [s.id, s]));
  const name = (id: string) => names.get(id)?.name ?? id;
  const internal = (id: string) => names.get(id)?.side === 'internal';
  const questions = opts.utterances.filter((u) => internal(u.s) && u.t.includes('?')).map((u) => ({ text: u.t.slice(0, 400), speaker: name(u.s), atMs: u.a }));
  const objections = opts.utterances
    .filter((u) => !internal(u.s) && /expensive|price|budget|caro|precio|presupuesto/i.test(u.t))
    .map((u) => ({ text: u.t.slice(0, 400), speaker: name(u.s), atMs: u.a, response: '' }));
  const stepUtts = opts.utterances.filter((u) => /\b(will|send|next week|by friday)\b/i.test(u.t));
  const nextSteps = stepUtts.map((u) => ({ text: u.t.slice(0, 400), owner: name(u.s), due: /friday/i.test(u.t) ? 'Friday' : '' }));
  const builtIn = findMentions(opts.utterances, ['Gong', 'Chorus', 'HubSpot', 'Salesforce']);
  const items = criteria.map((c, i) => ({ key: c.key, label: c.name, score: (i * 2 + 3) % 6, evidence: opts.utterances[i % opts.utterances.length]?.t.slice(0, 200) ?? '', atMs: opts.utterances[i % opts.utterances.length]?.a ?? null }));
  return {
    summary: `${opts.utterances.length} turns. ${opts.utterances[0]?.t ?? ''} ${opts.utterances[opts.utterances.length - 1]?.t ?? ''}`.trim().slice(0, 1000),
    nextSteps,
    topics: [
      { name: 'Current process', startMs: opts.utterances[0]?.a ?? 0 },
      { name: 'Pricing', startMs: objections[0]?.atMs ?? 0 },
      { name: 'Next steps', startMs: stepUtts[0]?.a ?? 0 },
    ],
    questions,
    objections,
    competitors: mergeCompetitors(known, builtIn),
    scorecard: { methodology: opts.settings.methodology, items, total: scoreTotal(items) },
    risks: nextSteps.length ? [] : ['No next step agreed'],
    model: 'calls-fake',
    generatedAt: nowIso(),
  };
}

// ---------- Preguntas ----------

export async function askCall(opts: { ws: string; title: string; utterances: Utterance[]; speakers: Speaker[]; question: string; locale: string }): Promise<string> {
  const q = opts.question.trim().slice(0, 1000);
  if (!q) throw new CallsError('invalid_input', 400);
  if (!opts.utterances.length) throw new CallsError('empty_transcript', 422);
  if (callsAiFake()) {
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const hit = opts.utterances.find((u) => words.some((w) => u.t.toLowerCase().includes(w))) ?? opts.utterances[0];
    return transcriptLines([hit], opts.speakers)[0];
  }
  const res = await aiGenerateText({
    workspaceId: opts.ws,
    feature: 'calls_ask',
    instructions: [
      'You answer questions about one recorded sales call using only its transcript.',
      'If the transcript does not say it, answer that it was not discussed. Never invent.',
      'Cite the moments you rely on with their [m:ss] marks. Be brief: a few sentences or a short list.',
      `Answer in ${LANG[opts.locale] ?? 'English'}.`,
    ].join('\n'),
    prompt: `Call: ${opts.title}\n\nTranscript:\n${transcriptForModel(opts.utterances, opts.speakers)}\n\nQuestion: ${q}`,
    maxOutputTokens: 800,
    timeoutMs: 60_000,
  });
  return res.text.trim();
}

export interface AskSource {
  id: string;
  title: string;
  at: string;
}

export interface AcrossCall {
  id: string;
  title: string;
  at: string;
  owner: string;
  summary: string;
  snippets: string[];
}

/** Respuesta sobre varias llamadas (las elegidas por la búsqueda), citando cuál dijo qué. */
export async function askAcross(opts: { ws: string; question: string; calls: AcrossCall[]; locale: string }): Promise<string> {
  const q = opts.question.trim().slice(0, 1000);
  if (!q) throw new CallsError('invalid_input', 400);
  if (!opts.calls.length) return '';
  if (callsAiFake()) return opts.calls.map((c, i) => `[${i + 1}] ${c.title}: ${c.snippets[0] ?? c.summary}`.slice(0, 300)).join('\n');
  const context = opts.calls
    .map((c, i) => `[${i + 1}] "${c.title}" (${c.at.slice(0, 10)}, ${c.owner})\nSummary: ${c.summary || '(none)'}\nExcerpts:\n${c.snippets.map((s) => `- ${s}`).join('\n')}`)
    .join('\n\n')
    .slice(0, 100_000);
  const res = await aiGenerateText({
    workspaceId: opts.ws,
    feature: 'calls_ask',
    instructions: [
      'You answer questions across a team\'s recorded sales calls, using only the calls given.',
      'Cite calls as [n] after each claim. If the calls do not answer it, say so. Never invent.',
      `Answer in ${LANG[opts.locale] ?? 'English'}. Be concise.`,
    ].join('\n'),
    prompt: `Calls:\n${context}\n\nQuestion: ${q}`,
    maxOutputTokens: 1000,
    timeoutMs: 60_000,
  });
  return res.text.trim();
}
