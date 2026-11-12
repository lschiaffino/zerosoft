/**
 * Calls (como Gong): tipos y reglas puras, sin base, para probarlas solas.
 *
 * Una llamada nace de tres formas: el bot entra a una reunión del calendario
 * (regla de la persona o interruptor de la reunión), alguien manda el bot ya
 * con un link, o se sube una grabación. Después: partes de la grabación,
 * transcripción, hablantes, análisis con IA y vínculo con el CRM.
 */
import { createHash, randomBytes } from 'crypto';

export type CallStatus =
  | 'scheduled'
  | 'queued'
  | 'joining'
  | 'waiting'
  | 'recording'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export const CALL_STATUSES: readonly CallStatus[] = ['scheduled', 'queued', 'joining', 'waiting', 'recording', 'uploading', 'processing', 'ready', 'failed', 'skipped', 'cancelled'];

/** Estados en los que el bot está (o va a estar) en la reunión. */
export const LIVE_STATUSES: readonly CallStatus[] = ['queued', 'joining', 'waiting', 'recording'];
/** Lo que aparece en la biblioteca (lo agendado y lo salteado va en Próximas). */
export const LIBRARY_STATUSES: readonly CallStatus[] = ['queued', 'joining', 'waiting', 'recording', 'uploading', 'processing', 'ready', 'failed'];

export type CallPlatform = 'meet' | 'zoom' | 'teams' | 'upload';
export type CallSource = 'bot' | 'upload';
export type AutoJoinRule = 'all' | 'external' | 'deals' | 'manual';
export const AUTO_JOIN_RULES: readonly AutoJoinRule[] = ['external', 'deals', 'all', 'manual'];
export type JoinMode = 'auto' | 'on' | 'off';
export type SpeakerSide = 'internal' | 'external';
export type Methodology = 'spiced' | 'meddic' | 'bant' | 'custom';
export const METHODOLOGIES: readonly Methodology[] = ['spiced', 'meddic', 'bant', 'custom'];

/** Parte de subida y de lectura: entra en una función de Vercel (corta el cuerpo en 4,5 MB). */
export const PART_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_VIDEO_PARTS = Math.ceil(MAX_UPLOAD_BYTES / PART_BYTES);
/** Segmentos de audio del bot (10 min cada uno): 3 horas son 18. */
export const MAX_AUDIO_SEGMENTS = 60;
/** Una subida se transcribe entera si es así de chica (tope de Whisper: 25 MB). */
export const MAX_DIRECT_TRANSCRIBE_BYTES = 24 * 1024 * 1024;
export const BOT_NAME = 'zerosoft Notetaker';
export const MAX_DURATION_SEC = 3 * 3600;
export const LOBBY_TIMEOUT_SEC = 10 * 60;
export const ALONE_TIMEOUT_SEC = 2 * 60;
/** Las reuniones se agendan con esta anticipación y el bot sale este tiempo antes. */
export const SYNC_WINDOW_MS = 24 * 3600_000;
export const DISPATCH_LEAD_MS = 60_000;

export class CallsError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface CallsActor {
  /** Workspace (id del owner). */
  ws: string;
  /** Persona que actúa. */
  person: string;
  admin: boolean;
  email: string;
  name: string;
}

export interface Attendee {
  name: string;
  email: string;
}

export interface Speaker {
  id: string;
  name: string;
  side: SpeakerSide;
  email?: string;
}

/** Un tramo de la transcripción: hablante, texto y tiempos (ms desde que empezó a grabar). */
export interface Utterance {
  s: string;
  t: string;
  a: number;
  b: number;
}

export interface TimelineEntry {
  name: string;
  startMs: number;
  endMs: number;
}

export interface Caption {
  speaker: string;
  text: string;
  startMs: number;
}

export interface CallMetrics {
  talkMs: number;
  /** Parte del tiempo de habla del equipo propio (0..1). null sin hablantes de un lado. */
  talkRatio: number | null;
  bySpeaker: Array<{ id: string; ms: number; share: number }>;
  longestMonologue: { speakerId: string; ms: number; startMs: number } | null;
  longestCustomerStory: { speakerId: string; ms: number; startMs: number } | null;
  /** Cambios de hablante por minuto. */
  interactivity: number;
  /** Pausa promedio (ms) antes de que el equipo propio responda. */
  patienceMs: number | null;
  questionsInternal: number;
  questionsExternal: number;
}

export interface ScoreItem {
  key: string;
  label: string;
  /** 0 a 5. */
  score: number;
  evidence: string;
  atMs: number | null;
}

export interface CallAnalysis {
  summary: string;
  nextSteps: Array<{ text: string; owner: string; due: string }>;
  topics: Array<{ name: string; startMs: number }>;
  questions: Array<{ text: string; speaker: string; atMs: number }>;
  objections: Array<{ text: string; speaker: string; atMs: number; response: string }>;
  competitors: Array<{ name: string; atMs: number; quote: string }>;
  scorecard: { methodology: Methodology; items: ScoreItem[]; total: number };
  /** Riesgos que ve el modelo (sin próximo paso, decisor ausente, etc.). */
  risks: string[];
  model: string;
  generatedAt: string;
}

export interface CallsSettings {
  methodology: Methodology;
  /** Criterios propios (methodology = custom): un nombre por línea. */
  customCriteria: string[];
  competitors: string[];
  /** 'team': todo el equipo ve las llamadas; 'private': solo quien grabó y los admins. */
  visibility: 'team' | 'private';
  botName: string;
  consentMessage: string;
  logToCrm: boolean;
  talkChannel: string;
  talkChannelSetBy: string | null;
  /**
   * Costo del procesamiento. 'economy': transcripción con Groq (Whisper large v3 turbo) si hay
   * GROQ_API_KEY y análisis con un modelo chico; 'premium': el proveedor de Voice y el modelo de la suite.
   */
  costTier: CallsCostTier;
}

export const CALLS_COST_TIERS = ['economy', 'premium'] as const;
export type CallsCostTier = (typeof CALLS_COST_TIERS)[number];
/** Modelo del análisis en modo económico (AI_MODEL_ECONOMY lo cambia). */
export function economyAnalysisModel(): string {
  return process.env.AI_MODEL_ECONOMY?.trim() || 'anthropic/claude-haiku-5-5';
}

export const DEFAULT_SETTINGS: CallsSettings = {
  methodology: 'spiced',
  customCriteria: [],
  competitors: [],
  visibility: 'team',
  botName: BOT_NAME,
  consentMessage: '',
  logToCrm: true,
  talkChannel: '',
  talkChannelSetBy: null,
  costTier: 'economy',
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix = 'call'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// ---------- Links de reunión ----------

// Acepta sin https://, www., y los prefijos /meet/ o /lookup/ que a veces trae el link copiado.
const MEET_RE = /^(?:https:\/\/)?(?:www\.)?meet\.google\.com\/(?:(?:meet|lookup)\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/i;
const ZOOM_RE = /^https:\/\/([a-z0-9-]+\.)?zoom\.(us|com)\/(j|my|w)\//i;
const TEAMS_RE = /^https:\/\/teams\.(microsoft|live)\.com\//i;

/** Plataforma de un link de reunión; null si no es una que conozcamos. */
export function platformOf(url: string | null | undefined): Exclude<CallPlatform, 'upload'> | null {
  const u = (url ?? '').trim();
  if (MEET_RE.test(u)) return 'meet';
  if (ZOOM_RE.test(u)) return 'zoom';
  if (TEAMS_RE.test(u)) return 'teams';
  return null;
}

/** Link de Meet limpio (sin query ni hash), o null. */
export function normalizeMeetUrl(url: string | null | undefined): string | null {
  const m = MEET_RE.exec((url ?? '').trim());
  return m ? `https://meet.google.com/${m[1].toLowerCase()}` : null;
}

/** El bot entra hoy solo a Google Meet; Zoom y Teams se ven pero no se graban. */
export function botSupports(platform: CallPlatform | null): boolean {
  return platform === 'meet';
}

// ---------- Reglas de agenda ----------

function domainOf(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/** Dominios de correo gratuitos: dos personas con gmail.com no son del mismo equipo. */
const FREE_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com']);

/**
 * ¿Hay alguien de afuera? Afuera = no es del workspace (por email) ni comparte
 * dominio (no gratuito) con quien tiene la reunión.
 */
export function hasExternalAttendee(attendees: Attendee[], ownEmail: string, memberEmails: Set<string>): boolean {
  const own = domainOf(ownEmail);
  return attendees.some((a) => {
    const e = a.email.toLowerCase();
    if (!e || memberEmails.has(e) || e === ownEmail.toLowerCase()) return false;
    const d = domainOf(e);
    return !(d && d === own && !FREE_DOMAINS.has(d));
  });
}

/** ¿El bot va a esta reunión? El interruptor de la reunión gana a la regla. */
export function shouldJoin(opts: { rule: AutoJoinRule; mode: JoinMode; supported: boolean; external: boolean; hasDeal: boolean }): boolean {
  if (!opts.supported || opts.mode === 'off') return false;
  if (opts.mode === 'on') return true;
  switch (opts.rule) {
    case 'all':
      return true;
    case 'external':
      return opts.external;
    case 'deals':
      return opts.external && opts.hasDeal;
    default:
      return false;
  }
}

// ---------- Formato ----------

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Título por defecto de una llamada sin evento de calendario. */
export function defaultTitle(platform: CallPlatform, when: Date, locale = 'en'): string {
  const label = platform === 'meet' ? 'Google Meet' : platform === 'zoom' ? 'Zoom' : platform === 'teams' ? 'Teams' : 'Call';
  return `${label} · ${when.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`;
}
