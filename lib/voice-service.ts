/**
 * Voice: los flujos que comparten las rutas de la app y la API v1 (la app de
 * escritorio). Server-only.
 */
import { transcribeAudio, providerDiarizes, FAKE_MEETING_ME, FAKE_MEETING_THEM } from './voice-transcribe';
import { askMeetings, cleanupDictation, enhanceMeeting, streamAskMeetings } from './voice-ai';
import { listSharedWithMe, resolveShare, type SharedMeetingView } from './voice-share';
import {
  canUploadChunk,
  claimChunk,
  createSession,
  getCustomTemplate,
  getSessionDetail,
  getSessionRow,
  getVoiceSettings,
  listDictionary,
  listSessions,
  releaseChunk,
  saveChat,
  saveChunkSegments,
  saveEnhanced,
  transcriptAsText,
  updateSession,
  VoiceError,
  type VoiceOwner,
} from './voice';
import { BUILTIN_TEMPLATE_SECTIONS, builtinTemplateInstructions, isBuiltinTemplate } from './voice-templates';
import { contactLabel, logMeetingToContact, type MeetingLabels } from './voice-integrations';
import type { OwnerScope } from './crm-visibility';
import { applyDictionary } from './voice-cleanup';
import {
  dictationTone,
  VOICE_ATTACHMENT_MAX_CHARS,
  VOICE_CONTEXTS,
  type VoiceChatAttachment,
  type VoiceChatMessage,
  type VoiceChatModel,
  type VoiceContext,
  type VoiceEnhanced,
  type VoiceSegment,
  type VoiceSessionSummary,
  type VoiceSource,
} from './voice-types';

export interface DictateTimings {
  /** Ajustes y diccionario de la persona. */
  setupMs: number;
  transcribeMs: number;
  cleanupMs: number;
  /** Guardar en el historial (0 si se guarda después de contestar). */
  saveMs: number;
  totalMs: number;
}

export interface DictateResult {
  session: VoiceSessionSummary;
  text: string;
  raw: string;
  ai: boolean;
  aiError: string | null;
  timings: DictateTimings;
}

export async function dictate(args: {
  owner: VoiceOwner;
  audio: Uint8Array;
  type: string;
  context?: string;
  sourceApp?: string;
  durationMs?: number;
  capture?: 'mic' | 'desktop';
  fakeText?: string;
  /** No guardar en el historial (p. ej. una prueba). */
  save?: boolean;
  /**
   * Modo rápido (la app de escritorio pega el texto apenas llega): limpieza
   * corta por reglas o con tope de tiempo, y el historial se guarda con
   * `later` después de contestar.
   */
  fast?: boolean;
  later?: (job: () => Promise<unknown>) => void;
}): Promise<DictateResult> {
  const t0 = Date.now();
  const [settings, dictionary] = await Promise.all([getVoiceSettings(args.owner), listDictionary(args.owner)]);
  const t1 = Date.now();
  const context: VoiceContext = (VOICE_CONTEXTS as readonly string[]).includes(args.context ?? '') ? (args.context as VoiceContext) : 'other';
  const tr = await transcribeAudio({
    workspaceId: args.owner.workspaceId,
    audio: args.audio,
    mimeType: args.type,
    language: settings.language,
    vocabulary: dictionary.filter((d) => d.kind === 'word' || d.kind === 'replace').map((d) => (d.kind === 'word' ? d.phrase : d.replacement)),
    durationHintMs: args.durationMs,
    fakeText: args.fakeText,
  });
  const t2 = Date.now();
  const tone = dictationTone(settings, context);
  // raw: la transcripción tal cual, solo con los reemplazos y snippets del diccionario.
  const cleaned = tone
    ? await cleanupDictation({ workspaceId: args.owner.workspaceId, raw: tr.text, context, tone, dictionary, useAi: settings.aiCleanup, fast: args.fast })
    : { text: applyDictionary(tr.text.replace(/\s+/g, ' ').trim(), dictionary), ai: false, aiError: null };
  const t3 = Date.now();
  const timings = (saveMs: number): DictateTimings => ({ setupMs: t1 - t0, transcribeMs: t2 - t1, cleanupMs: t3 - t2, saveMs, totalMs: t3 - t0 + saveMs });
  const durationMs = tr.durationMs || args.durationMs || 0;
  const input = {
    kind: 'dictation' as const,
    status: 'done' as const,
    capture: args.capture ?? 'mic',
    context,
    sourceApp: args.sourceApp,
    rawText: tr.text,
    text: cleaned.text,
    language: tr.language,
    durationMs,
  };
  const deferred = args.save !== false && !!cleaned.text && !!args.fast && !!args.later;
  if (deferred) args.later!(() => createSession(args.owner, input));
  if (args.save === false || !cleaned.text || deferred) {
    const now = new Date().toISOString();
    return {
      session: {
        id: '',
        kind: 'dictation',
        title: '',
        status: 'done',
        capture: args.capture ?? 'mic',
        context,
        sourceApp: args.sourceApp ?? '',
        text: cleaned.text,
        durationMs,
        words: 0,
        templateKey: 'general',
        calBookingId: null,
        contactId: null,
        folderId: null,
        startedAt: now,
        endedAt: now,
        updatedAt: now,
      },
      text: cleaned.text,
      raw: tr.text,
      ai: cleaned.ai,
      aiError: cleaned.aiError,
      timings: timings(0),
    };
  }
  const row = await createSession(args.owner, input);
  const t4 = Date.now();
  const [summary] = (await listSessions(args.owner, { kind: 'dictation', limit: 1 })).filter((s) => s.id === row.id);
  return {
    session: summary ?? {
      id: row.id,
      kind: 'dictation',
      title: '',
      status: 'done',
      capture: row.capture,
      context,
      sourceApp: row.source_app,
      text: row.text,
      durationMs,
      words: row.words,
      templateKey: row.template_key,
      calBookingId: null,
      contactId: null,
      folderId: null,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      updatedAt: row.updated_at,
    },
    text: cleaned.text,
    raw: tr.text,
    ai: cleaned.ai,
    aiError: cleaned.aiError,
    timings: timings(t4 - t3),
  };
}

/**
 * Un trozo de audio de una reunión → segmentos de transcripción. Idempotente
 * por (sesión, fuente, número): un reintento devuelve `duplicate: true`.
 */
export async function ingestChunk(args: {
  owner: VoiceOwner;
  sessionId: string;
  source: VoiceSource;
  seq: number;
  offsetMs: number;
  durationMs: number;
  audio: Uint8Array;
  type: string;
  fakeText?: string;
  /** Pestaña que graba (la app web); la app de escritorio no lo manda. */
  recorderId?: string | null;
}): Promise<{ segments: VoiceSegment[]; duplicate: boolean }> {
  const row = await getSessionRow(args.owner, args.sessionId);
  if (!row || row.kind !== 'meeting') throw new VoiceError('not_found');
  if (!canUploadChunk(row, args.recorderId ?? null)) throw new VoiceError('not_recorder');
  if (!(await claimChunk(args.sessionId, args.source, args.seq))) return { segments: [], duplicate: true };
  try {
    const [settings, dictionary] = await Promise.all([getVoiceSettings(args.owner), listDictionary(args.owner)]);
    const tr = await transcribeAudio({
      workspaceId: args.owner.workspaceId,
      audio: args.audio,
      mimeType: args.type,
      language: settings.language,
      vocabulary: dictionary.filter((d) => d.kind === 'word').map((d) => d.phrase),
      durationHintMs: args.durationMs,
      fakeText: args.fakeText ?? (args.source === 'me' ? FAKE_MEETING_ME : FAKE_MEETING_THEM),
      fakeSpeakers: args.source !== 'me',
    });
    // En la pista del micrófono habla la persona: no se separan hablantes.
    const pieces = args.source === 'me' || !providerDiarizes(tr.provider) ? tr.pieces.map((p) => ({ ...p, speaker: '' })) : tr.pieces;
    const segments = await saveChunkSegments({
      sessionId: args.sessionId,
      source: args.source,
      seq: args.seq,
      offsetMs: args.offsetMs,
      durationMs: tr.durationMs || args.durationMs,
      pieces,
    });
    if (!row.language && tr.language) await updateSession(args.owner, args.sessionId, { language: tr.language });
    return { segments, duplicate: false };
  } catch (err) {
    await releaseChunk(args.sessionId, args.source, args.seq);
    throw err;
  }
}

/** Instrucciones y títulos de la plantilla elegida (de fábrica o propia). */
async function templateFor(owner: VoiceOwner, key: string, builtinNames: Record<string, string>) {
  if (isBuiltinTemplate(key)) {
    return { instructions: builtinTemplateInstructions(key), headings: BUILTIN_TEMPLATE_SECTIONS[key], name: builtinNames[key] ?? key };
  }
  const custom = await getCustomTemplate(owner, key);
  if (custom) {
    return {
      instructions: `Follow this template from the user:\n${custom.instructions || custom.name}`,
      headings: custom.instructions.split('\n').map((l) => l.replace(/^[#\-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 10),
      name: custom.name,
    };
  }
  return { instructions: builtinTemplateInstructions('general'), headings: BUILTIN_TEMPLATE_SECTIONS.general, name: builtinNames.general ?? 'General' };
}

export async function enhance(args: {
  owner: VoiceOwner;
  scope: OwnerScope | null;
  sessionId: string;
  locale: string;
  labels: MeetingLabels;
  builtinNames: Record<string, string>;
  templateKey?: string;
}): Promise<{ enhanced: VoiceEnhanced; enhancedAt: string; crmActivityId: string | null }> {
  if (args.templateKey) await updateSession(args.owner, args.sessionId, { templateKey: args.templateKey });
  const d = await getSessionDetail(args.owner, args.sessionId);
  if (!d || d.kind !== 'meeting') throw new VoiceError('not_found');
  if (!d.segments.length && !d.myNotes.trim()) throw new VoiceError('invalid_state');
  const tpl = await templateFor(args.owner, d.templateKey, args.builtinNames);
  const contact = await contactLabel(args.owner.workspaceId, d.contactId);
  const enhanced = await enhanceMeeting({
    workspaceId: args.owner.workspaceId,
    myNotes: d.myNotes,
    transcript: transcriptAsText(d.segments, d.speakers, args.labels),
    templateInstructions: tpl.instructions,
    headings: tpl.headings,
    locale: args.locale,
    title: d.title,
    when: d.startedAt.slice(0, 16).replace('T', ' '),
    attendees: contact?.name ?? '',
  });
  const enhancedAt = await saveEnhanced(d.id, enhanced);
  // Webhooks y Flow de quien grabó (voice.notes.ready).
  const { emitVoiceEvent } = await import('./voice-events');
  await emitVoiceEvent(d.id, 'voice.notes.ready', enhanced);
  let crmActivityId = d.crmActivityId;
  // Con contacto vinculado, la nota queda en su timeline (y se actualiza al regenerar).
  if (d.contactId && args.scope !== undefined) {
    const res = await logMeetingToContact({
      owner: args.owner,
      scope: args.scope,
      detail: { ...d, enhanced, enhancedAt },
      labels: args.labels,
    }).catch(() => null);
    if (res?.ok) crmActivityId = res.activityId;
  }
  return { enhanced, enhancedAt, crmActivityId };
}

/** Contexto de una reunión para el chat: título, asistentes, notas, resumen y transcripción con tiempos. */
async function meetingChatContext(owner: VoiceOwner, sessionId: string, labels: MeetingLabels) {
  const d = await getSessionDetail(owner, sessionId);
  if (!d || d.kind !== 'meeting') throw new VoiceError('not_found');
  const people = d.attendees.map((a) => a.name || a.email).filter(Boolean);
  const context = [
    `# ${d.title || labels.fromVoice} (${d.startedAt.slice(0, 10)})`,
    people.length ? `Attendees: ${people.join(', ')}` : '',
    d.myNotes.trim() ? `## ${labels.myNotes}\n${d.myNotes.trim()}` : '',
    d.enhanced?.summary ? `## ${labels.summary}\n${d.enhanced.summary}` : '',
    d.enhanced?.decisions.length ? `## ${labels.decisions}\n${d.enhanced.decisions.map((x) => `- ${x}`).join('\n')}` : '',
    d.enhanced?.actionItems.length ? `## ${labels.actionItems}\n${d.enhanced.actionItems.map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ''}`).join('\n')}` : '',
    `## ${labels.transcript}\n${transcriptAsText(d.segments, d.speakers, labels)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { d, context, live: d.status === 'recording' };
}

/**
 * Suma la pregunta y la respuesta al chat guardado. Relee el chat recién: si
 * otra pestaña preguntó mientras tanto, no se pisa.
 */
async function appendChat(owner: VoiceOwner, sessionId: string, question: string, answer: string, thread?: string): Promise<VoiceChatMessage[]> {
  const fresh = await getSessionDetail(owner, sessionId);
  if (!fresh) throw new VoiceError('not_found');
  const now = new Date().toISOString();
  const tag = thread ? { thread } : {};
  const next: VoiceChatMessage[] = [...fresh.chat, { role: 'user', text: question, at: now, ...tag }, { role: 'assistant', text: answer, at: now, ...tag }];
  await saveChat(fresh.id, next);
  return next.slice(-60);
}

/** Mensajes de una conversación de la reunión (la primera no tiene `thread`). */
export function threadMessages(chat: VoiceChatMessage[], thread?: string): VoiceChatMessage[] {
  return chat.filter((m) => (m.thread ?? '') === (thread ?? ''));
}

/** El archivo adjunto va al final del contexto, recortado. */
export function withAttachment(context: string, attachment?: VoiceChatAttachment): string {
  if (!attachment?.text.trim()) return context;
  return `${context}\n\n## Attached file: ${attachment.name.slice(0, 120)}\n${attachment.text.slice(0, VOICE_ATTACHMENT_MAX_CHARS)}`;
}

export interface ChatArgs {
  owner: VoiceOwner;
  sessionId: string;
  question: string;
  /** Lo que queda en el chat como pregunta (un recipe se ve como "/Nombre"). */
  shownQuestion?: string;
  locale: string;
  labels: MeetingLabels;
  /** Conversación dentro de la reunión ("Nuevo chat"). */
  thread?: string;
  model?: VoiceChatModel;
  attachment?: VoiceChatAttachment;
}

function askArgs(args: ChatArgs, d: { chat: VoiceChatMessage[] }, context: string, live: boolean) {
  return {
    workspaceId: args.owner.workspaceId,
    question: args.question,
    context: withAttachment(context, args.attachment),
    history: threadMessages(d.chat, args.thread).map((m) => ({ role: m.role, text: m.text })),
    locale: args.locale,
    across: false,
    live,
    model: args.model,
  };
}

export async function chat(args: ChatArgs): Promise<VoiceChatMessage[]> {
  const { d, context, live } = await meetingChatContext(args.owner, args.sessionId, args.labels);
  const answer = await askMeetings(askArgs(args, d, context, live));
  return appendChat(args.owner, d.id, args.shownQuestion ?? args.question, answer, args.thread);
}

/**
 * Chat sobre una reunión de a pedazos. Tira antes de devolver si la reunión
 * no existe o no hay IA; `finish` guarda la pregunta y la respuesta completa.
 */
export async function chatStream(args: ChatArgs & { abortSignal?: AbortSignal }): Promise<{
  deltas: AsyncIterable<string>;
  finish: (answer: string) => Promise<VoiceChatMessage[]>;
}> {
  const { d, context, live } = await meetingChatContext(args.owner, args.sessionId, args.labels);
  const deltas = await streamAskMeetings({ ...askArgs(args, d, context, live), abortSignal: args.abortSignal });
  return { deltas, finish: (answer) => appendChat(args.owner, d.id, args.shownQuestion ?? args.question, answer.trim(), args.thread) };
}

const TIME_WORDS = [
  'today', 'yesterday', 'week', 'month', 'last', 'past', 'days', 'this',
  'hoy', 'ayer', 'semana', 'pasada', 'mes', 'pasado', 'últimos', 'ultimos', 'últimas', 'días', 'dias', 'esta', 'este',
  'hoje', 'ontem', 'passada', 'passado', 'mês', 'última', 'último',
];

/** Palabras de la pregunta que sirven para buscar reuniones (con los nombres propios cortos, como "Ana"). */
export function questionKeywords(q: string): string[] {
  const stop = new Set([
    'what', 'when', 'where', 'which', 'about', 'there', 'that', 'this', 'with', 'from', 'have', 'said', 'dijo', 'sobre', 'cuando', 'donde', 'para', 'como', 'qué', 'quién',
    'disse', 'quando', 'reunión', 'meeting', 'reunião', 'meetings', 'reuniones', 'reuniões', 'agree', 'agreed', 'decide', 'decided', 'acordamos', 'acordaron', 'quedamos',
    'decidimos', 'combinamos', 'they', 'were', 'will', 'should', 'could', 'would', 'does', 'what’s', 'cuál', 'cual', 'qual', 'quais', 'todas', 'todos', 'mis', 'minhas', 'meus', 'my', 'our',
    'did', 'the', 'and', 'who', 'was', 'how', 'why', 'say', 'qué', 'que', 'con', 'com', 'del', 'los', 'las', 'una', 'uno', 'por', 'dos', 'das', 'nos', 'les',
    ...TIME_WORDS,
  ]);
  const tokens = q.split(/[^\p{L}\p{N}’']+/u).filter(Boolean);
  const out: string[] = [];
  tokens.forEach((raw, i) => {
    const w = raw.toLowerCase().replace(/['’]s$/, '');
    if (stop.has(w) || /^\d+$/.test(w)) return;
    const name = i > 0 && /^\p{Lu}/u.test(raw) && w.length >= 2;
    if (w.length > 3 || name) out.push(w);
  });
  return [...new Set(out)].slice(0, 6);
}

/**
 * Rango de fechas que pide la pregunta ("last week", "la semana pasada",
 * "ontem"...), generoso a propósito: "la semana pasada" incluye los últimos 7
 * días aunque crucen el lunes. null si no pide ninguno.
 */
export function questionRange(q: string, now = new Date()): { from: string; to: string } | null {
  const s = q.toLowerCase();
  const day = 86_400_000;
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + day);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * day);
  const iso = (d: Date) => d.toISOString();
  const nDays = s.match(/(?:last|past|últimos|ultimos|últimas)\s+(\d{1,3})\s+(?:days|días|dias)/);
  if (nDays) return { from: iso(new Date(today.getTime() - Number(nDays[1]) * day)), to: iso(tomorrow) };
  if (/\byesterday\b|\bayer\b|\bontem\b/.test(s)) return { from: iso(new Date(today.getTime() - day)), to: iso(today) };
  if (/\btoday\b|\bhoy\b|\bhoje\b/.test(s)) return { from: iso(today), to: iso(tomorrow) };
  if (/last week|past week|semana pasada|semana passada|última semana|ultima semana/.test(s)) {
    const prevMonday = new Date(monday.getTime() - 7 * day);
    const weekAgo = new Date(today.getTime() - 7 * day);
    return { from: iso(prevMonday < weekAgo ? prevMonday : weekAgo), to: iso(tomorrow) };
  }
  if (/this week|esta semana/.test(s)) return { from: iso(monday), to: iso(tomorrow) };
  if (/last month|past month|mes pasado|mês passado|último mês|ultimo mes|último mes/.test(s)) {
    return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))), to: iso(tomorrow) };
  }
  if (/this month|este mes|este mês/.test(s)) return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(tomorrow) };
  return null;
}

/** Una reunión que usó la respuesta: [M1], [M2]... en el texto citan a estas. */
export interface AcrossSource {
  label: string;
  /** Id de la reunión propia, o el token del link si la compartió otra persona. */
  id: string;
  title: string;
  startedAt: string;
  href: string;
  /** La compartió otra persona del workspace (el nombre de quien la grabó). */
  sharedBy?: string;
}

const ACROSS_MAX = 6;
const ACROSS_SHARED_MAX = 3;

/**
 * Elige las reuniones para una pregunta entre varias y arma el contexto. Las
 * propias salen de listSessions (solo las de la persona); con `includeShared`,
 * también las que otra persona del workspace compartió con ella, leídas por
 * resolveShare: lo mismo que vería al abrir el link (sin transcripción si no
 * la incluyeron).
 */
async function gatherAcross(args: {
  owner: VoiceOwner;
  searchText: string;
  labels: MeetingLabels;
  includeShared?: boolean;
  now?: Date;
}): Promise<{ sources: AcrossSource[]; context: string }> {
  const range = questionRange(args.searchText, args.now);
  const words = questionKeywords(args.searchText);
  const hits = new Map<string, { s: VoiceSessionSummary; n: number }>();
  for (const w of words) {
    for (const s of await listSessions(args.owner, { kind: 'meeting', q: w, limit: 8, from: range?.from, to: range?.to })) {
      const cur = hits.get(s.id);
      hits.set(s.id, { s, n: (cur?.n ?? 0) + 1 });
    }
  }
  let own = [...hits.values()].sort((a, b) => b.n - a.n || b.s.startedAt.localeCompare(a.s.startedAt)).map((x) => x.s);
  if (!own.length) own = await listSessions(args.owner, { kind: 'meeting', limit: range ? ACROSS_MAX : 4, from: range?.from, to: range?.to });
  own = own.slice(0, ACROSS_MAX);

  const parts: string[] = [];
  const sources: AcrossSource[] = [];
  for (const s of own) {
    const d = await getSessionDetail(args.owner, s.id);
    if (!d) continue;
    const label = `M${sources.length + 1}`;
    sources.push({ label, id: d.id, title: d.title, startedAt: d.startedAt, href: `/app/voice/meetings/${d.id}` });
    const people = d.attendees.map((a) => a.name || a.email).filter(Boolean);
    parts.push(
      [
        `# [${label}] ${d.title || args.labels.fromVoice} (${d.startedAt.slice(0, 10)})`,
        people.length ? `Attendees: ${people.join(', ')}` : '',
        d.enhanced?.summary ?? '',
        d.enhanced?.decisions.length ? `${args.labels.decisions}: ${d.enhanced.decisions.join('; ')}` : '',
        d.enhanced?.actionItems.length ? `${args.labels.actionItems}: ${d.enhanced.actionItems.map((a) => a.text).join('; ')}` : '',
        !d.enhanced && d.myNotes.trim() ? `${args.labels.myNotes}:\n${d.myNotes.trim().slice(0, 4000)}` : '',
        transcriptAsText(d.segments, d.speakers, args.labels, { max: 20_000 }),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (args.includeShared && words.length) {
    const shared = (await listSharedWithMe(args.owner, { limit: 60 }))
      .filter((m) => !range || (m.startedAt >= range.from && m.startedAt < range.to))
      .slice(0, 15);
    const scored: Array<{ token: string; n: number; view: SharedMeetingView }> = [];
    for (const m of shared) {
      const r = await resolveShare(m.token, args.owner.personId);
      if (r.state !== 'ok') continue;
      const v = r.view;
      const hay = [v.title, v.myNotes, v.enhanced?.summary ?? '', ...(v.enhanced?.sections.flatMap((x) => x.points.map((p) => p.text)) ?? []), ...(v.segments ?? []).map((g) => g.text)]
        .join('\n')
        .toLowerCase();
      const n = words.filter((w) => hay.includes(w)).length;
      if (n > 0) scored.push({ token: m.token, n, view: v });
    }
    for (const { token, view: v } of scored.sort((a, b) => b.n - a.n).slice(0, ACROSS_SHARED_MAX)) {
      const label = `M${sources.length + 1}`;
      sources.push({ label, id: token, title: v.title, startedAt: v.startedAt, href: `/m/${token}`, sharedBy: v.ownerName });
      parts.push(
        [
          `# [${label}] ${v.title || args.labels.fromVoice} (${v.startedAt.slice(0, 10)}), shared by ${v.ownerName}`,
          v.enhanced?.summary ?? '',
          v.enhanced?.sections.map((x) => `${x.heading}: ${x.points.map((p) => p.text).join('; ')}`).join('\n') ?? '',
          v.myNotes.trim() ? v.myNotes.trim().slice(0, 4000) : '',
          v.segments ? transcriptAsText(v.segments, v.speakers, args.labels, { max: 12_000 }) : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }
  return { sources, context: parts.join('\n\n') };
}

export interface AskAcrossArgs {
  owner: VoiceOwner;
  question: string;
  /** Texto para buscar las reuniones (por defecto, la pregunta). Un recipe busca por el tema, no por su prompt. */
  searchText?: string;
  locale: string;
  labels: MeetingLabels;
  /** Charla previa (preguntas de seguimiento). */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** Sumar lo que compartieron con la persona (la app web; la API y el MCP ven solo lo propio). */
  includeShared?: boolean;
  now?: Date;
}

/** Pregunta sobre varias reuniones: se buscan las que mencionan la pregunta y se responde citándolas. */
export async function askAcross(args: AskAcrossArgs): Promise<{ answer: string; meetings: AcrossSource[] }> {
  const { sources, context } = await gatherAcross({ ...args, searchText: args.searchText ?? args.question });
  const answer = sources.length
    ? await askMeetings({
        workspaceId: args.owner.workspaceId,
        question: args.question,
        context,
        history: args.history ?? [],
        locale: args.locale,
        across: true,
      })
    : '';
  return { answer, meetings: sources };
}

/** askAcross de a pedazos: primero las reuniones elegidas, después el texto. */
export async function askAcrossStream(args: AskAcrossArgs & { abortSignal?: AbortSignal }): Promise<{ meetings: AcrossSource[]; deltas: AsyncIterable<string> | null }> {
  const { sources, context } = await gatherAcross({ ...args, searchText: args.searchText ?? args.question });
  if (!sources.length) return { meetings: [], deltas: null };
  const deltas = await streamAskMeetings({
    workspaceId: args.owner.workspaceId,
    question: args.question,
    context,
    history: args.history ?? [],
    locale: args.locale,
    across: true,
    abortSignal: args.abortSignal,
  });
  return { meetings: sources, deltas };
}
