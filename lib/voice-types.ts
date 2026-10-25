/**
 * Voice: tipos y constantes compartidos por el servidor y la UI (puro, sin
 * base ni red). Ver lib/voice.ts para el modelo de datos.
 */

export const VOICE_CONTEXTS = ['email', 'chat', 'note', 'other'] as const;
export type VoiceContext = (typeof VOICE_CONTEXTS)[number];

export const VOICE_TONES = ['formal', 'neutral', 'casual'] as const;
export type VoiceTone = (typeof VOICE_TONES)[number];

export const VOICE_SOURCES = ['me', 'them', 'mixed'] as const;
export type VoiceSource = (typeof VOICE_SOURCES)[number];

export const VOICE_CAPTURES = ['mic', 'mic_tab', 'file', 'desktop'] as const;
export type VoiceCapture = (typeof VOICE_CAPTURES)[number];

export const VOICE_DICTIONARY_KINDS = ['word', 'replace', 'snippet'] as const;
export type VoiceDictionaryKind = (typeof VOICE_DICTIONARY_KINDS)[number];

/** Plantillas de fábrica (el texto de cada una vive en lib/voice-templates.ts). */
export const VOICE_BUILTIN_TEMPLATES = ['general', 'sales', 'one_on_one', 'standup', 'interview', 'customer'] as const;
export type VoiceBuiltinTemplate = (typeof VOICE_BUILTIN_TEMPLATES)[number];

/** Idiomas que se pueden fijar para transcribir ('auto' = detectar). */
export const VOICE_LANGUAGES = ['auto', 'en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'ja', 'zh', 'hi', 'ko', 'ru', 'pl', 'tr', 'uk'] as const;

/** Tope de un trozo de audio subido directo a la API (Vercel corta los cuerpos en 4.5 MB). */
export const VOICE_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
/** Tope de un archivo subido a Blob para transcribir de una vez. */
export const VOICE_FILE_MAX_BYTES = 200 * 1024 * 1024;
/** Duración de cada trozo que graba el navegador en una reunión. */
export const VOICE_CHUNK_MS = 20_000;
/** Tope de un dictado (como Wispr Flow: unos minutos por dictado). */
export const VOICE_DICTATION_MAX_MS = 6 * 60_000;
export const VOICE_TITLE_MAX = 200;
export const VOICE_NOTES_MAX = 40_000;
export const VOICE_DICTIONARY_MAX = 500;
export const VOICE_TEMPLATES_MAX = 50;
/** Tipos de audio aceptados (los que graban MediaRecorder y la app de escritorio, más archivos comunes). */
export const VOICE_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'video/webm',
  'video/mp4',
] as const;

export function isVoiceAudioType(type: string): boolean {
  const base = type.split(';')[0].trim().toLowerCase();
  return (VOICE_AUDIO_TYPES as readonly string[]).includes(base);
}

export interface VoiceSettings {
  /** Tono por contexto (Styles de Wispr Flow). */
  styles: Record<VoiceContext, VoiceTone>;
  /** 'auto' o código ISO-639-1. */
  language: string;
  /** Atajo de mantener para dictar en la web, p. ej. "Alt+Space". */
  shortcut: string;
  /** Mostrar el botón de dictado al enfocar un campo de texto. */
  showBar: boolean;
  /** Limpieza con IA (si está apagada, solo reglas: diccionario, muletillas y puntuación). */
  aiCleanup: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  styles: { email: 'formal', chat: 'casual', note: 'neutral', other: 'neutral' },
  language: 'auto',
  shortcut: 'Alt+Space',
  showBar: true,
  aiCleanup: true,
};

export const VOICE_SHORTCUTS = ['Alt+Space', 'Ctrl+Space', 'Alt+D', 'Ctrl+Shift+Space'] as const;

export interface VoiceSessionSummary {
  id: string;
  kind: 'dictation' | 'meeting';
  title: string;
  status: 'recording' | 'processing' | 'done' | 'error';
  capture: string;
  context: string;
  sourceApp: string;
  text: string;
  durationMs: number;
  words: number;
  templateKey: string;
  calBookingId: string | null;
  contactId: string | null;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  /** Fragmento que coincidió con la búsqueda (transcripción o notas). */
  match?: string;
}

export interface VoiceSegment {
  id: string;
  source: VoiceSource;
  seq: number;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface VoiceEnhancedPoint {
  text: string;
  /** De dónde salió: lo que escribió la persona o la transcripción. */
  source: 'mine' | 'transcript';
}

export interface VoiceEnhanced {
  summary: string;
  sections: Array<{ heading: string; points: VoiceEnhancedPoint[] }>;
  decisions: string[];
  actionItems: Array<{ text: string; owner: string; due: string }>;
}

export interface VoiceChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface VoiceSessionDetail extends VoiceSessionSummary {
  rawText: string;
  language: string;
  speakers: Record<string, string>;
  crmActivityId: string | null;
  docsPageId: string | null;
  noteId: string | null;
  error: string;
  segments: VoiceSegment[];
  myNotes: string;
  enhanced: VoiceEnhanced | null;
  enhancedAt: string | null;
  chat: VoiceChatMessage[];
}

export interface VoiceDictionaryEntry {
  id: string;
  kind: VoiceDictionaryKind;
  phrase: string;
  replacement: string;
}

export interface VoiceTemplate {
  id: string;
  name: string;
  instructions: string;
  builtin: boolean;
}

/** Clave del hablante en el mapa de nombres: "me", "them" o "them:<n>". */
export function speakerKey(source: VoiceSource, speaker: string): string {
  if (source === 'me') return 'me';
  return speaker ? `${source}:${speaker}` : source;
}

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** "Alt+Space" → piezas para comparar con un KeyboardEvent. */
export function parseShortcut(raw: string): { alt: boolean; ctrl: boolean; shift: boolean; meta: boolean; code: string } {
  const parts = raw.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1] || 'space';
  const code = key === 'space' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key;
  return {
    alt: parts.includes('alt') || parts.includes('option'),
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    code,
  };
}

/** Contexto de dictado según la ruta de la app (si el campo no lo declara con data-voice-context). */
export function contextForPath(path: string): VoiceContext {
  const p = path.replace(/^\/(en|es|pt)(?=\/)/, '');
  if (/^\/app\/(chat|groups|talk)\b/.test(p)) return 'chat';
  if (/^\/app\/crm\/(email|sequences|inbox)\b/.test(p)) return 'email';
  if (/^\/app\/(docs|notes|track|voice|board)\b/.test(p)) return 'note';
  return 'other';
}

/** Duración "m:ss" o "h:mm:ss". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
