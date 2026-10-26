/**
 * Voice: IA de dictados y reuniones, todo por lib/ai.ts (cuota, rate limit y
 * ai_usage). Server-only.
 * - Limpieza de un dictado (puntuación, muletillas, autocorrecciones, listas,
 *   tono según el contexto) con el diccionario de la persona.
 * - Nota mejorada de una reunión: combina lo que escribió la persona con la
 *   transcripción siguiendo una plantilla; cada punto dice de dónde salió.
 * - Chat sobre una reunión y sobre varias.
 *
 * En e2e (VOICE_AI_FAKE=1, nunca en un deploy de producción) corre contra el
 * modelo falso de lib/crm-ai-fake.ts con respuestas deterministas; la cookie
 * voice_ai_fake=off hace que el request se comporte como sin IA.
 */
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel, type FakeCallInfo, type FakeStep } from './crm-ai-fake';
import { ruleCleanup, applyDictionary } from './voice-cleanup';
import type { VoiceContext, VoiceDictionaryEntry, VoiceEnhanced, VoiceTone } from './voice-types';

const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

async function voiceAiFakeState(): Promise<'on' | 'off' | null> {
  if (process.env.VOICE_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return null;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('voice_ai_fake')?.value === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

/** ¿Hay IA para Voice en este request? (sin tirar: la UI lo usa para avisar). */
export async function voiceAiAvailable(): Promise<boolean> {
  const state = await voiceAiFakeState();
  if (state) return state === 'on';
  const { aiEnabled } = await import('./ai');
  return aiEnabled();
}

async function voiceModel(ws: string, fake: (info: FakeCallInfo) => FakeStep): Promise<{ model: LanguageModel; modelId: string }> {
  const state = await voiceAiFakeState();
  if (state === 'on') {
    await assertAiQuota(ws);
    return { model: fakeModel(fake), modelId: 'voice-fake' };
  }
  if (state === 'off') throw new AiError('ai_disabled');
  await assertAiAvailable(ws);
  return resolveAiModel();
}

async function record(ws: string, feature: string, modelId: string, usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  await recordAiUsage({
    workspaceId: ws,
    feature,
    model: modelId,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  }).catch(() => {});
}

// ---------- Dictado ----------

const TONE_TEXT: Record<VoiceTone, string> = {
  formal: 'formal and polished, full sentences',
  neutral: 'clear and natural',
  casual: 'casual and relaxed, like a chat message (lowercase starts and no final period are fine only if the speaker sounds that way)',
};

const CONTEXT_TEXT: Record<VoiceContext, string> = {
  email: 'an email',
  chat: 'a chat message',
  note: 'a note or document',
  other: 'a text field',
};

export function cleanupInstructions(opts: { context: VoiceContext; tone: VoiceTone; words: string[] }): string {
  return [
    'You clean up dictated speech so it can be pasted as written text.',
    `It will be pasted into ${CONTEXT_TEXT[opts.context]}. Tone: ${TONE_TEXT[opts.tone]}.`,
    'Rules:',
    '- Keep the speaker\'s words and meaning. Do not add facts, greetings, sign-offs or answers. Do not translate.',
    '- Add punctuation and capitals. Remove filler words (um, uh, eh, este, tipo, né) and false starts.',
    '- Apply spoken self-corrections: "Monday, no, I mean Tuesday" or "el lunes, no, quise decir el martes" keeps only the correction. "Scratch that" deletes the previous sentence.',
    '- When the speaker lists items ("first… second…", "primero… segundo…") write a numbered list. "New line" and "new paragraph" are line breaks.',
    opts.words.length ? `- Spell these names and terms exactly like this: ${opts.words.slice(0, 200).join(', ')}.` : '',
    'Reply with the cleaned text only.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Limpia un dictado. Con la IA apagada o sin cuota devuelve la limpieza por
 * reglas y `ai: false` (el dictado no se pierde). Los reemplazos del
 * diccionario siempre se aplican al final.
 */
export async function cleanupDictation(opts: {
  workspaceId: string;
  raw: string;
  context: VoiceContext;
  tone: VoiceTone;
  dictionary: VoiceDictionaryEntry[];
  useAi: boolean;
}): Promise<{ text: string; ai: boolean; aiError: string | null }> {
  const raw = opts.raw.trim();
  if (!raw) return { text: '', ai: false, aiError: null };
  if (!opts.useAi) return { text: ruleCleanup(raw, opts.dictionary), ai: false, aiError: null };
  try {
    const { model, modelId } = await voiceModel(opts.workspaceId, () => ({ text: ruleCleanup(raw, []) }));
    const words = opts.dictionary.filter((d) => d.kind === 'word').map((d) => d.phrase);
    const res = await generateText({
      model,
      instructions: cleanupInstructions({ context: opts.context, tone: opts.tone, words }),
      prompt: raw.slice(0, 20_000),
      temperature: 0,
      maxOutputTokens: 4000,
      timeout: 30_000,
      maxRetries: 1,
    });
    await record(opts.workspaceId, 'voice_cleanup', modelId, res.totalUsage);
    const text = applyDictionary(res.text.trim(), opts.dictionary) || ruleCleanup(raw, opts.dictionary);
    return { text, ai: true, aiError: null };
  } catch (err) {
    if (err instanceof AiError) return { text: ruleCleanup(raw, opts.dictionary), ai: false, aiError: err.code };
    console.error('[voice] cleanup failed', err instanceof Error ? err.message : 'error');
    return { text: ruleCleanup(raw, opts.dictionary), ai: false, aiError: 'ai_failed' };
  }
}

// ---------- Nota mejorada ----------

const enhancedSchema = z.object({
  summary: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      points: z.array(z.object({ text: z.string(), source: z.enum(['mine', 'transcript']) })),
    }),
  ),
  decisions: z.array(z.string()),
  actionItems: z.array(z.object({ text: z.string(), owner: z.string(), due: z.string() })),
});

/** Respuesta del modelo falso: los renglones de la persona y frases de la transcripción. */
export function fakeEnhanced(myNotes: string, transcript: string, headings: string[]): VoiceEnhanced {
  const mine = myNotes
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.\s]+/, '').trim())
    .filter(Boolean);
  const sentences = transcript
    .split('\n')
    .map((l) => l.replace(/^\[[\d:]+\]\s*/, ''))
    .flatMap((l) => {
      const idx = l.indexOf(': ');
      const who = idx > 0 ? l.slice(0, idx) : '';
      const body = idx > 0 ? l.slice(idx + 2) : l;
      return (body.match(/[^.!?]+[.!?]?/g) ?? []).map((s) => ({ who, text: s.trim() }));
    })
    .filter((s) => s.text);
  const decisions = [...new Set(sentences.filter((s) => /\b(decide|agree|acord|decid|combin)/i.test(s.text)).map((s) => s.text))];
  const actions = sentences
    .filter((s) => /\b(I will|I'll|will send|voy a|vamos a|vou)\b/i.test(s.text))
    .map((s) => ({ text: s.text.replace(/^I will\s+/i, '').replace(/^\w/, (c) => c.toUpperCase()), owner: s.who, due: /friday|viernes|sexta/i.test(s.text) ? 'Friday' : '' }))
    .filter((a, i, all) => all.findIndex((b) => b.text === a.text) === i);
  return {
    summary: sentences.slice(0, 2).map((s) => s.text).join(' ') || mine.slice(0, 2).join('. '),
    sections: [
      {
        heading: headings[0] ?? 'Notes',
        points: [...mine.map((text) => ({ text, source: 'mine' as const })), ...[...new Set(sentences.map((s) => s.text))].slice(0, 3).map((text) => ({ text, source: 'transcript' as const }))],
      },
    ],
    decisions,
    actionItems: actions,
  };
}

export function enhanceInstructions(opts: { templateInstructions: string; locale: string; title: string; when: string; attendees: string }): string {
  return [
    'You write meeting notes like an excellent assistant who was in the room.',
    'Inputs: the notes the user typed during the meeting (short, partial) and the transcript ("Me" is the user).',
    'Expand the user\'s notes with what was said: keep every point the user wrote (mark those points source "mine"), fill the gaps from the transcript (source "transcript"). Never invent facts, numbers or names that are not in the inputs.',
    opts.templateInstructions,
    'Points are short sentences. Also return: a two or three sentence summary, the decisions taken, and action items with owner (a name from the transcript, or "" if unclear) and due date as said (or "").',
    `Write in the language of the transcript; if unclear, ${LANG_NAME[opts.locale] ?? 'English'}.`,
    `Meeting: ${opts.title || 'untitled'}${opts.when ? `, ${opts.when}` : ''}${opts.attendees ? `, with ${opts.attendees}` : ''}.`,
  ].join('\n');
}

export async function enhanceMeeting(opts: {
  workspaceId: string;
  myNotes: string;
  transcript: string;
  templateInstructions: string;
  headings: string[];
  locale: string;
  title: string;
  when: string;
  attendees: string;
}): Promise<VoiceEnhanced> {
  const { model, modelId } = await voiceModel(opts.workspaceId, () => ({
    text: JSON.stringify(fakeEnhanced(opts.myNotes, opts.transcript, opts.headings)),
  }));
  const res = await generateText({
    model,
    instructions: enhanceInstructions(opts),
    prompt: `<my_notes>\n${opts.myNotes.slice(0, 20_000) || '(none)'}\n</my_notes>\n<transcript>\n${opts.transcript || '(empty)'}\n</transcript>`,
    output: Output.object({ schema: enhancedSchema }),
    temperature: 0.2,
    maxOutputTokens: 6000,
    timeout: 90_000,
    maxRetries: 1,
  });
  await record(opts.workspaceId, 'voice_notes', modelId, res.totalUsage);
  const out = res.output as VoiceEnhanced;
  return {
    summary: out.summary.slice(0, 4000),
    sections: out.sections.slice(0, 20).map((s) => ({ heading: s.heading.slice(0, 200), points: s.points.slice(0, 60) })),
    decisions: out.decisions.slice(0, 40),
    actionItems: out.actionItems.slice(0, 40),
  };
}

// ---------- Chat ----------

/** Respuesta del modelo falso: la línea de la transcripción con la palabra más larga de la pregunta. */
export function fakeAnswer(question: string, context: string): string {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3)
    .sort((a, b) => b.length - a.length);
  // Primero las líneas de la transcripción ("[mm:ss] Nombre: texto"), después el resto.
  const all = context.split('\n');
  const lines = [...all.filter((l) => /^\[[\d:]+\]/.test(l)), ...all.filter((l) => !/^\[[\d:]+\]/.test(l))];
  for (const w of words) {
    const hit = lines.find((l) => l.toLowerCase().includes(w));
    if (hit) return hit.replace(/^\[[\d:]+\]\s*/, '');
  }
  return 'The meeting does not mention that.';
}

export async function askMeetings(opts: {
  workspaceId: string;
  question: string;
  /** Una o varias reuniones, cada una con su título y transcripción/notas. */
  context: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  locale: string;
  across: boolean;
}): Promise<string> {
  const { model, modelId } = await voiceModel(opts.workspaceId, () => ({ text: fakeAnswer(opts.question, opts.context) }));
  const res = await generateText({
    model,
    instructions: [
      opts.across
        ? 'Answer questions about the user\'s meetings using only the meetings below. Name the meeting (title and date) each fact comes from.'
        : 'Answer questions about this meeting using only its notes and transcript. When someone said something, say who.',
      'If the answer is not there, say so. Be brief. Quote short phrases when useful.',
      `Answer in the language of the question; if unclear, ${LANG_NAME[opts.locale] ?? 'English'}.`,
      `<meetings>\n${opts.context}\n</meetings>`,
    ].join('\n'),
    messages: [
      ...opts.history.slice(-8).map((m) => ({ role: m.role, content: m.text })),
      { role: 'user' as const, content: opts.question.slice(0, 2000) },
    ],
    temperature: 0.2,
    maxOutputTokens: 1500,
    timeout: 60_000,
    maxRetries: 1,
  });
  await record(opts.workspaceId, 'voice_chat', modelId, res.totalUsage);
  return res.text.trim();
}
