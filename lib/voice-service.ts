/**
 * Voice: los flujos que comparten las rutas de la app y la API v1 (la app de
 * escritorio). Server-only.
 */
import { transcribeAudio, providerDiarizes, FAKE_MEETING_ME, FAKE_MEETING_THEM } from './voice-transcribe';
import { askMeetings, cleanupDictation, enhanceMeeting } from './voice-ai';
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
import {
  VOICE_CONTEXTS,
  type VoiceChatMessage,
  type VoiceContext,
  type VoiceEnhanced,
  type VoiceSegment,
  type VoiceSessionSummary,
  type VoiceSource,
} from './voice-types';

export interface DictateResult {
  session: VoiceSessionSummary;
  text: string;
  raw: string;
  ai: boolean;
  aiError: string | null;
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
}): Promise<DictateResult> {
  const [settings, dictionary] = await Promise.all([getVoiceSettings(args.owner), listDictionary(args.owner)]);
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
  const cleaned = await cleanupDictation({
    workspaceId: args.owner.workspaceId,
    raw: tr.text,
    context,
    tone: settings.styles[context],
    dictionary,
    useAi: settings.aiCleanup,
  });
  const durationMs = tr.durationMs || args.durationMs || 0;
  if (args.save === false || !cleaned.text) {
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
    };
  }
  const row = await createSession(args.owner, {
    kind: 'dictation',
    status: 'done',
    capture: args.capture ?? 'mic',
    context,
    sourceApp: args.sourceApp,
    rawText: tr.text,
    text: cleaned.text,
    language: tr.language,
    durationMs,
  });
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

export async function chat(args: {
  owner: VoiceOwner;
  sessionId: string;
  question: string;
  /** Lo que queda en el chat como pregunta (un recipe se ve como "/Nombre"). */
  shownQuestion?: string;
  locale: string;
  labels: MeetingLabels;
}): Promise<VoiceChatMessage[]> {
  const d = await getSessionDetail(args.owner, args.sessionId);
  if (!d || d.kind !== 'meeting') throw new VoiceError('not_found');
  const context = [
    `# ${d.title || args.labels.fromVoice} (${d.startedAt.slice(0, 10)})`,
    d.myNotes.trim() ? `## ${args.labels.myNotes}\n${d.myNotes.trim()}` : '',
    d.enhanced?.summary ? `## ${args.labels.summary}\n${d.enhanced.summary}` : '',
    `## ${args.labels.transcript}\n${transcriptAsText(d.segments, d.speakers, args.labels)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const answer = await askMeetings({
    workspaceId: args.owner.workspaceId,
    question: args.question,
    context,
    history: d.chat.map((m) => ({ role: m.role, text: m.text })),
    locale: args.locale,
    across: false,
  });
  const now = new Date().toISOString();
  const next: VoiceChatMessage[] = [...d.chat, { role: 'user', text: args.shownQuestion ?? args.question, at: now }, { role: 'assistant', text: answer, at: now }];
  await saveChat(d.id, next);
  return next;
}

/** Palabras de la pregunta que sirven para buscar reuniones. */
export function questionKeywords(q: string): string[] {
  const stop = new Set(['what', 'when', 'where', 'which', 'about', 'there', 'that', 'this', 'with', 'from', 'have', 'said', 'dijo', 'sobre', 'cuando', 'donde', 'para', 'como', 'qué', 'quién', 'disse', 'quando', 'sobre', 'reunión', 'meeting', 'reunião']);
  return [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !stop.has(w)))].slice(0, 6);
}

/** Pregunta sobre varias reuniones: se buscan las que mencionan la pregunta y se responde citándolas. */
export async function askAcross(args: {
  owner: VoiceOwner;
  question: string;
  /** Texto para buscar las reuniones (por defecto, la pregunta). Un recipe busca por el tema, no por su prompt. */
  searchText?: string;
  locale: string;
  labels: MeetingLabels;
}): Promise<{ answer: string; meetings: Array<{ id: string; title: string; startedAt: string }> }> {
  const found = new Map<string, VoiceSessionSummary>();
  for (const w of questionKeywords(args.searchText ?? args.question)) {
    for (const s of await listSessions(args.owner, { kind: 'meeting', q: w, limit: 5 })) found.set(s.id, s);
    if (found.size >= 6) break;
  }
  if (!found.size) for (const s of await listSessions(args.owner, { kind: 'meeting', limit: 4 })) found.set(s.id, s);
  const picked = [...found.values()].slice(0, 6);
  const parts: string[] = [];
  for (const s of picked) {
    const d = await getSessionDetail(args.owner, s.id);
    if (!d) continue;
    parts.push(
      [`# ${d.title || args.labels.fromVoice} (${d.startedAt.slice(0, 10)})`, d.enhanced?.summary ?? '', transcriptAsText(d.segments, d.speakers, args.labels, { max: 20_000 })]
        .filter(Boolean)
        .join('\n'),
    );
  }
  const answer = picked.length
    ? await askMeetings({
        workspaceId: args.owner.workspaceId,
        question: args.question,
        context: parts.join('\n\n'),
        history: [],
        locale: args.locale,
        across: true,
      })
    : '';
  return { answer, meetings: picked.map((s) => ({ id: s.id, title: s.title, startedAt: s.startedAt })) };
}
