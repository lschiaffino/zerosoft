/**
 * Docs: IA del editor, preguntas sobre el workspace y notas de reunión
 * (tanda D4, como Notion AI). Todo pasa por lib/ai.ts: cuota mensual, rate
 * limit y registro en ai_usage por workspace.
 *
 * En e2e (DOCS_AI_FAKE=1, nunca en un deploy de producción) responde un
 * modelo falso determinista armado con los mismos datos que vería el real;
 * con la cookie `docs_ai_fake=off` se comporta como sin IA (ai_disabled).
 * Server-only.
 */
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel } from './crm-ai-fake';
import { docsAiFakeActive, languageName } from './docs-db-ai';
import type { DocsActor } from './docs';
import { readablePageRows, visibleBlocksFor } from './docs-platform-access';
import { blocksToPlainText } from './docs-platform-text';
import { rankKnowledge } from './knowledge-search';

// ---------- Modelo ----------

async function docsModel(ws: string, fake: () => string): Promise<{ model: LanguageModel; modelId: string }> {
  if (await docsAiFakeActive()) {
    await assertAiQuota(ws);
    return { model: fakeModel(() => ({ text: fake() })), modelId: 'docs-fake' };
  }
  // Con el fake configurado pero apagado por cookie: como sin IA.
  if (process.env.DOCS_AI_FAKE === '1' && process.env.VERCEL_ENV !== 'production') throw new AiError('ai_disabled');
  await assertAiAvailable(ws);
  return resolveAiModel();
}

async function record(ws: string, feature: string, modelId: string, usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  await recordAiUsage({ workspaceId: ws, feature, model: modelId, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 }).catch(() => {});
}

/** Status HTTP de un error de la IA (ai_disabled: no configurada; cuota y rate limit: 429). */
export function aiErrorStatus(code: string): number {
  return code === 'ai_disabled' ? 503 : code === 'quota_exceeded' || code === 'rate_limited' ? 429 : 502;
}

// ---------- Editor ----------

export const EDITOR_AI_ACTIONS = [
  'continue',
  'summarize',
  'improve',
  'fix',
  'shorter',
  'longer',
  'simplify',
  'tone',
  'translate',
  'explain',
  'action_items',
  'brainstorm',
  'custom',
] as const;
export type EditorAiAction = (typeof EDITOR_AI_ACTIONS)[number];
export const EDITOR_AI_TONES = ['professional', 'casual', 'friendly', 'confident', 'direct'] as const;
export type EditorAiTone = (typeof EDITOR_AI_TONES)[number];
export const EDITOR_AI_LANGUAGES = ['en', 'es', 'pt', 'fr', 'de', 'it', 'ja', 'zh'] as const;

export interface EditorAiRequest {
  action: EditorAiAction;
  tone?: EditorAiTone;
  language?: string;
  /** Instrucción propia (custom) o extra. */
  prompt?: string;
  /** Texto seleccionado (vacío: trabaja sobre la página o escribe en la línea). */
  selection?: string;
  pageTitle: string;
  pageText: string;
  /** Texto antes del cursor (continuar escribiendo). */
  before?: string;
}

const TASKS: Record<EditorAiAction, string> = {
  continue: 'Continue writing from where the text before the cursor ends. Match its language, voice and format. Write one to three paragraphs; do not repeat what is already there.',
  summarize: 'Summarize the target text in a short paragraph followed by the key points as a bulleted list.',
  improve: 'Improve the writing of the target text: clearer, better flow, same meaning, same language and format.',
  fix: 'Fix spelling and grammar in the target text. Change nothing else.',
  shorter: 'Make the target text shorter (about half), keeping the key information.',
  longer: 'Make the target text longer with useful detail, without inventing facts.',
  simplify: 'Rewrite the target text in simpler language that anyone can follow.',
  tone: 'Rewrite the target text in the requested tone. Keep the meaning and the language.',
  translate: 'Translate the target text to the requested language. Keep the format (headings, lists, bold).',
  explain: 'Explain the target text in plain words, as a short paragraph and a few bullets if they help.',
  action_items: 'List the action items in the target text as a Markdown to-do list ("- [ ] task"), with the owner in parentheses if the text names one.',
  brainstorm: 'Brainstorm ideas about the topic the user gives (or the page topic) as a bulleted list of 5 to 10 short ideas.',
  custom: 'Do what the user asks with the target text (or write what they ask if there is no target text).',
};

export function editorInstructions(req: EditorAiRequest): string {
  const extra =
    req.action === 'tone' ? ` Tone: ${req.tone ?? 'professional'}.` : req.action === 'translate' ? ` Language: ${languageName(req.language)}.` : '';
  return [
    'You are the writing assistant inside a document editor (like Notion AI).',
    'Answer with the text to insert only: Markdown (headings, lists, to-dos, bold, links, tables), no preamble, no explanation of what you did, no surrounding quotes or code fences.',
    'Never invent facts, names, numbers or quotes that are not in the page or in the request.',
    `Task: ${TASKS[req.action]}${extra}`,
  ].join('\n');
}

export function editorPrompt(req: EditorAiRequest): string {
  const target = req.selection?.trim() ? req.selection.slice(0, 12_000) : req.action === 'continue' ? '' : req.pageText.slice(0, 24_000);
  return [
    `<page title="${req.pageTitle.replace(/"/g, "'").slice(0, 200)}">`,
    req.pageText.slice(0, 24_000),
    '</page>',
    req.action === 'continue' ? `<before_cursor>\n${(req.before ?? req.pageText).slice(-6000)}\n</before_cursor>` : `<target>\n${target}\n</target>`,
    req.prompt?.trim() ? `<request>\n${req.prompt.trim().slice(0, 2000)}\n</request>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const words = (t: string, n: number) => t.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, n).join(' ');

/** Lo que responde el modelo falso: determinista y con los mismos datos. */
export function fakeEditorAnswer(req: EditorAiRequest): string {
  const target = (req.selection?.trim() || req.pageText || req.pageTitle || '').trim();
  switch (req.action) {
    case 'continue':
      return `${words(req.before ?? req.pageText, 6) || req.pageTitle} continues here with the next idea.`;
    case 'summarize':
      return `Summary: ${words(target, 12)}\n\n- ${words(target, 5)}`;
    case 'translate':
      return `[${(req.language ?? 'en').toLowerCase()}] ${target}`;
    case 'tone':
      return `(${req.tone ?? 'professional'}) ${target}`;
    case 'shorter':
      return words(target, Math.max(3, Math.ceil(target.split(/\s+/).length / 2)));
    case 'longer':
      return `${target} More detail about this point.`;
    case 'fix':
    case 'improve':
    case 'simplify':
      return target.charAt(0).toUpperCase() + target.slice(1).replace(/\s+/g, ' ');
    case 'explain':
      return `This means: ${words(target, 12)}`;
    case 'action_items':
      return `- [ ] Follow up on ${words(target, 4)}`;
    case 'brainstorm':
      return `- Idea one about ${words(req.prompt || req.pageTitle, 3)}\n- Idea two\n- Idea three`;
    default:
      return `${req.prompt?.trim() ?? ''}: ${words(target, 10)}`.trim();
  }
}

/** Corre una acción del editor y devuelve el Markdown a insertar. */
export async function runEditorAi(ws: string, req: EditorAiRequest, abortSignal?: AbortSignal): Promise<string> {
  const { model, modelId } = await docsModel(ws, () => fakeEditorAnswer(req));
  const result = await generateText({
    model,
    instructions: editorInstructions(req),
    prompt: editorPrompt(req),
    maxOutputTokens: req.action === 'longer' || req.action === 'continue' || req.action === 'custom' ? 1500 : 1000,
    temperature: req.action === 'brainstorm' || req.action === 'continue' ? 0.7 : 0.3,
    timeout: 45_000,
    maxRetries: 1,
    abortSignal,
  });
  await record(ws, 'docs_editor', modelId, result.totalUsage);
  return cleanAnswer(result.text);
}

/** Saca las vallas de código y comillas que algunos modelos agregan alrededor. */
export function cleanAnswer(text: string): string {
  let t = text.trim();
  const fence = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1].trim();
  return t.slice(0, 40_000);
}

// ---------- Preguntas sobre el workspace ----------

export interface AskCitation {
  n: number;
  pageId: string;
  title: string;
  url: string;
  snippet: string;
}

export interface AskResult {
  answer: string;
  citations: AskCitation[];
}

/**
 * Responde una pregunta con las páginas que la persona puede leer (y que la
 * IA puede usar), citando con [n] las fuentes. Recuperación BM25 en memoria
 * sobre las páginas más recientes.
 */
export async function askWorkspace(actor: DocsActor, question: string): Promise<AskResult | { error: 'no_matches' }> {
  const q = question.trim().slice(0, 1000);
  const pages = await readablePageRows(actor, { forAi: true, limit: 400 });
  const docs = await Promise.all(
    pages.map(async (p) => ({
      kind: 'page' as const,
      title: p.title || 'Untitled',
      source: p.id,
      text: blocksToPlainText(await visibleBlocksFor(p, p.content, { actor }), 30_000),
    })),
  );
  const ranked = rankKnowledge(docs, q, 8);
  if (ranked.length === 0) return { error: 'no_matches' };
  // Una cita por página (la primera vez que aparece), numeradas en orden de relevancia.
  const citations: AskCitation[] = [];
  const numOf = new Map<string, number>();
  for (const r of ranked) {
    if (!r.source || numOf.has(r.source)) continue;
    numOf.set(r.source, citations.length + 1);
    citations.push({ n: citations.length + 1, pageId: r.source, title: r.title, url: `/app/docs/${r.source}`, snippet: r.text.slice(0, 240) });
  }
  const context = ranked.map((r) => `<source n="${numOf.get(r.source ?? '')}" title="${r.title.replace(/"/g, "'")}">\n${r.text}\n</source>`).join('\n\n');
  const ws = actor.id;
  const { model, modelId } = await docsModel(ws, () => {
    const first = ranked[0];
    return `${words(first.text, 18)} [${numOf.get(first.source ?? '') ?? 1}]`;
  });
  const result = await generateText({
    model,
    instructions: [
      'You answer questions about a team workspace using only the sources given (pages the person can open).',
      'Cite every claim with the source number in square brackets, like [1] or [2][3]. Use only numbers that appear in the sources.',
      'If the sources do not answer the question, say so in one sentence and do not guess.',
      'Answer in the language of the question, in short Markdown (a paragraph and bullets if useful).',
    ].join('\n'),
    prompt: `${context}\n\n<question>\n${q}\n</question>`,
    maxOutputTokens: 900,
    temperature: 0.2,
    timeout: 45_000,
    maxRetries: 1,
  });
  await record(ws, 'docs_ask', modelId, result.totalUsage);
  const answer = cleanAnswer(result.text);
  // Solo las fuentes que la respuesta cita (si no cita ninguna, todas las usadas).
  const cited = new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  return { answer, citations: cited.size ? citations.filter((c) => cited.has(c.n)) : citations };
}

// ---------- Notas de reunión ----------

export interface MeetingNotes {
  summary: string;
  decisions: string[];
  actions: Array<{ text: string; owner: string; due: string }>;
}

const meetingSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  actions: z.array(z.object({ text: z.string(), owner: z.string(), due: z.string() })),
});

export function fakeMeetingNotes(transcript: string): MeetingNotes {
  const lines = transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const decision = lines.find((l) => /decid|agree|ship|acord|decidi/i.test(l));
  const action = lines.filter((l) => /will|todo|follow|send|enviar|va a|vou/i.test(l));
  return {
    summary: words(transcript, 20),
    decisions: decision ? [decision.replace(/^[^:]{1,40}:\s*/, '')] : [],
    actions: action.slice(0, 5).map((l) => {
      const m = /^([^:]{1,40}):\s*(.*)$/.exec(l);
      return { text: (m ? m[2] : l).slice(0, 200), owner: m ? m[1] : '', due: '' };
    }),
  };
}

/** Resumen, decisiones y tareas de una transcripción (y las notas escritas a mano, si hay). */
export async function summarizeMeeting(ws: string, input: { title: string; transcript: string; notes?: string; language?: string }): Promise<MeetingNotes> {
  const transcript = input.transcript.trim();
  if (transcript.length < 40) throw new Error('transcript_too_short');
  const { model, modelId } = await docsModel(ws, () => JSON.stringify(fakeMeetingNotes(transcript)));
  const result = await generateText({
    model,
    instructions: [
      'You write meeting notes from a transcript (like AI meeting notes in Notion).',
      'summary: 2 to 5 sentences on what was discussed. decisions: what the group decided (empty if nothing was decided).',
      'actions: concrete next steps; owner = the person named as responsible ("" if none), due = a date or deadline said in the meeting ("" if none).',
      'Use only what is in the transcript and the notes. Never invent names, dates or numbers.',
      `Write in ${input.language ? languageName(input.language) : 'the language of the transcript'}.`,
    ].join('\n'),
    prompt: `<meeting title="${input.title.replace(/"/g, "'").slice(0, 200)}">\n${input.notes ? `<notes>\n${input.notes.slice(0, 8000)}\n</notes>\n` : ''}<transcript>\n${transcript.slice(-120_000)}\n</transcript>\n</meeting>`,
    output: Output.object({ schema: meetingSchema }),
    maxOutputTokens: 1800,
    temperature: 0.2,
    timeout: 60_000,
    maxRetries: 1,
  });
  await record(ws, 'docs_meeting', modelId, result.totalUsage);
  const out = result.output as MeetingNotes;
  return {
    summary: out.summary.trim().slice(0, 4000),
    decisions: out.decisions.map((d) => d.trim()).filter(Boolean).slice(0, 30),
    actions: out.actions.map((a) => ({ text: a.text.trim().slice(0, 300), owner: a.owner.trim().slice(0, 100), due: a.due.trim().slice(0, 60) })).filter((a) => a.text).slice(0, 40),
  };
}

/** Transcripción falsa de un trozo de audio (e2e). */
export function fakeTranscript(seq: number): string {
  const lines = [
    'Ada: Thanks for joining. We decided to ship the beta on Friday.',
    'Grace: I will send the release notes to the team tomorrow.',
    'Ada: Linus will follow up with the design review.',
  ];
  return lines[seq % lines.length];
}
