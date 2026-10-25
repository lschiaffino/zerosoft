/**
 * Groups: reglas puras (sin base ni red) para tickets, SLA, mensajes sin
 * responder y el ritmo de los envíos masivos. Las usan el servidor, la UI y
 * los tests.
 */

/** Tipo de media para mostrar: imagen, audio, video o archivo (el resto). */
export function mediaKind(mime: string): 'image' | 'audio' | 'video' | 'file' {
  const major = String(mime ?? '').split('/')[0].toLowerCase();
  if (major === 'image' || major === 'sticker') return 'image';
  if (major === 'audio' || major === 'ptt') return 'audio';
  if (major === 'video') return 'video';
  return 'file';
}

/** Valor de una propiedad propia como texto (listas, CSV, variables). */
export function propertyText(v: unknown, type?: string): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(String).join(type === 'cascade' ? ' › ' : ', ');
  if (typeof v === 'object') return String((v as { name?: unknown }).name ?? '');
  return String(v);
}

/** Marcador de vista previa sin texto ni nombre ([image], [file]...), o null. */
export function previewToken(preview: string): 'image' | 'audio' | 'video' | 'file' | 'call' | null {
  const m = /^\[(image|audio|video|file|call)\]$/.exec(String(preview ?? '').trim());
  return m ? (m[1] as 'image' | 'audio' | 'video' | 'file' | 'call') : null;
}

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export interface GroupsSettings {
  /** Reaccionar con este emoji a un mensaje crea un ticket. Vacío: apagado. */
  ticketEmoji: string;
  /** Palabras que crean un ticket cuando aparecen en un mensaje entrante. */
  ticketKeywords: string[];
  /** Minutos para la primera respuesta de un ticket. */
  firstResponseMin: number;
  /** Minutos para resolver, por prioridad. */
  resolutionMin: Record<TicketPriority, number>;
  /** Un chat con un mensaje de cliente sin respuesta por más de esto queda marcado. */
  unansweredMin: number;
  defaultPriority: TicketPriority;
  /** 'time': todo mensaje de cliente espera respuesta; 'questions': la AI marca solo preguntas y pedidos. */
  flagMode: 'time' | 'questions';
  /** Reglas en texto para la AI ("los 'gracias' no son preguntas", "todo lo de facturación sí"). */
  flagRules: string;
  /** Crear un ticket desde un mensaje saca al chat de "sin responder". */
  unflagOnTicket: boolean;
  /** Email cuando vence el SLA de un ticket. */
  slaEmail: boolean;
  slaEmailAssignee: boolean;
  slaEmailAdmins: boolean;
  /** Emails extra (hasta 10). */
  slaEmailExtra: string[];
  /** Idioma de los emails del workspace (el de quien guardó los ajustes). */
  locale: 'en' | 'es' | 'pt';
}

export const DEFAULT_SETTINGS: GroupsSettings = {
  ticketEmoji: '🎫',
  ticketKeywords: [],
  firstResponseMin: 60,
  resolutionMin: { urgent: 240, high: 480, medium: 1440, low: 4320 },
  unansweredMin: 30,
  defaultPriority: 'medium',
  flagMode: 'time',
  flagRules: '',
  unflagOnTicket: true,
  slaEmail: false,
  slaEmailAssignee: true,
  slaEmailAdmins: false,
  slaEmailExtra: [],
  locale: 'en',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Emails pegados (comas, espacios, saltos) → válidos, únicos, en minúscula. */
export function parseEmails(raw: unknown, max = 10): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\s,;]+/);
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => e.length <= 200 && EMAIL_RE.test(e)))].slice(0, max);
}

const MAX_MIN = 60 * 24 * 60; // 60 días

function clampMin(v: unknown, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_MIN);
}

/** Ajustes guardados (JSON) → ajustes completos y válidos. */
export function normalizeSettings(raw: unknown): GroupsSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GroupsSettings> & Record<string, unknown>;
  const res = (r.resolutionMin ?? {}) as Partial<Record<TicketPriority, number>>;
  const keywords = Array.isArray(r.ticketKeywords) ? r.ticketKeywords : [];
  return {
    ticketEmoji: typeof r.ticketEmoji === 'string' ? r.ticketEmoji.trim().slice(0, 16) : DEFAULT_SETTINGS.ticketEmoji,
    ticketKeywords: [
      ...new Set(
        keywords
          .map((k) => String(k).trim().toLowerCase())
          .filter((k) => k.length >= 2 && k.length <= 40),
      ),
    ].slice(0, 30),
    firstResponseMin: clampMin(r.firstResponseMin, DEFAULT_SETTINGS.firstResponseMin),
    resolutionMin: {
      urgent: clampMin(res.urgent, DEFAULT_SETTINGS.resolutionMin.urgent),
      high: clampMin(res.high, DEFAULT_SETTINGS.resolutionMin.high),
      medium: clampMin(res.medium, DEFAULT_SETTINGS.resolutionMin.medium),
      low: clampMin(res.low, DEFAULT_SETTINGS.resolutionMin.low),
    },
    unansweredMin: clampMin(r.unansweredMin, DEFAULT_SETTINGS.unansweredMin),
    defaultPriority: (TICKET_PRIORITIES as readonly string[]).includes(String(r.defaultPriority))
      ? (r.defaultPriority as TicketPriority)
      : DEFAULT_SETTINGS.defaultPriority,
    flagMode: r.flagMode === 'questions' ? 'questions' : 'time',
    flagRules: typeof r.flagRules === 'string' ? r.flagRules.trim().slice(0, 1000) : '',
    unflagOnTicket: typeof r.unflagOnTicket === 'boolean' ? r.unflagOnTicket : DEFAULT_SETTINGS.unflagOnTicket,
    slaEmail: r.slaEmail === true,
    slaEmailAssignee: typeof r.slaEmailAssignee === 'boolean' ? r.slaEmailAssignee : DEFAULT_SETTINGS.slaEmailAssignee,
    slaEmailAdmins: r.slaEmailAdmins === true,
    slaEmailExtra: parseEmails(r.slaEmailExtra),
    locale: r.locale === 'es' || r.locale === 'pt' ? r.locale : 'en',
  };
}

/**
 * Sin AI (o si falla), una regla simple decide si un mensaje pide respuesta:
 * signo de pregunta o palabras de pedido al principio. Lo usan el modo
 * "preguntas" de respaldo y los tests.
 */
export function looksLikeQuestion(body: string): boolean {
  const text = String(body ?? '').trim().toLowerCase();
  if (!text) return false;
  if (/[?¿]/.test(text)) return true;
  return /^(how|what|when|where|why|who|which|can|could|is|are|do|does|did|will|would|please|help|need|cómo|qué|cuándo|dónde|por qué|quién|cuál|pueden|podés|podrías|podrían|necesito|necesitamos|ayuda|por favor|me pasan|como faço|quando|onde|quem|qual|pode|preciso|precisamos|ajuda)(?=[\s,.!:]|$)/.test(
    text,
  );
}

/** Sin selectores de variante ni tono de piel: "🎫️" y "🎫" son el mismo. */
export function normalizeEmoji(e: string): string {
  return String(e ?? '')
    .replace(/[︎️]/g, '')
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
    .trim();
}

export function reactionCreatesTicket(settings: Pick<GroupsSettings, 'ticketEmoji'>, emoji: string): boolean {
  const want = normalizeEmoji(settings.ticketEmoji);
  return want !== '' && normalizeEmoji(emoji) === want;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Primera palabra clave que aparece como palabra entera (sin importar
 * mayúsculas ni tildes). null si ninguna.
 */
export function matchKeyword(keywords: readonly string[], body: string): string | null {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const text = fold(body ?? '');
  if (!text) return null;
  for (const k of keywords) {
    const kw = fold(k).trim();
    if (!kw) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(kw)}($|[^\\p{L}\\p{N}])`, 'u');
    if (re.test(text)) return k;
  }
  return null;
}

/** Título de un ticket a partir del mensaje: la primera línea, hasta 120 caracteres. */
export function ticketTitleFrom(body: string, fallback = 'Ticket'): string {
  const line = String(body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

const addMin = (from: Date, min: number) => new Date(from.getTime() + min * 60_000);

/** Vencimientos del ticket: primera respuesta y resolución según prioridad. */
export function ticketDue(
  priority: TicketPriority,
  settings: Pick<GroupsSettings, 'firstResponseMin' | 'resolutionMin'>,
  from: Date,
): { firstResponseDueAt: string; dueAt: string } {
  return {
    firstResponseDueAt: addMin(from, settings.firstResponseMin).toISOString(),
    dueAt: addMin(from, settings.resolutionMin[priority]).toISOString(),
  };
}

export interface SlaTicket {
  status: TicketStatus;
  due_at: string | null;
  first_response_due_at: string | null;
  first_response_at: string | null;
}

/** El ticket está vencido: sin resolver pasado el vencimiento, o sin primera respuesta a tiempo. */
export function isTicketBreached(t: SlaTicket, now: Date): boolean {
  if (t.status === 'resolved' || t.status === 'closed') return false;
  const ms = now.getTime();
  if (t.due_at && Date.parse(t.due_at) <= ms) return true;
  if (!t.first_response_at && t.first_response_due_at && Date.parse(t.first_response_due_at) <= ms) return true;
  return false;
}

/** Minutos que lleva un chat esperando respuesta (null si no espera). */
export function waitingMinutes(awaitingSince: string | null, now: Date): number | null {
  if (!awaitingSince) return null;
  const t = Date.parse(awaitingSince);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 60_000));
}

export function isUnansweredDue(awaitingSince: string | null, unansweredMin: number, now: Date): boolean {
  const w = waitingMinutes(awaitingSince, now);
  return w !== null && w >= unansweredMin;
}

// ---------- Envíos masivos ----------

/** Tope por número, sumando todos sus envíos: protege al número de un bloqueo. */
export const NUMBER_MAX_PER_MINUTE = 60;
export const BROADCAST_MIN_PER_MINUTE = 1;
export const BROADCAST_MAX_PER_MINUTE = 60;

export function clampPerMinute(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 20;
  return Math.min(BROADCAST_MAX_PER_MINUTE, Math.max(BROADCAST_MIN_PER_MINUTE, n));
}

/**
 * Cuántos mensajes puede mandar ahora un envío, con ventana deslizante de 60 s:
 * su propio ritmo (`perMinute`) menos lo que mandó en el último minuto, y el
 * tope del número menos lo que mandó el número (todos sus envíos) en ese minuto.
 */
export function allowedSends(opts: {
  perMinute: number;
  /** Momentos (ms) de los envíos de este broadcast. */
  broadcastSentAt: readonly number[];
  /** Momentos (ms) de todos los envíos masivos del número. */
  numberSentAt: readonly number[];
  now: number;
  numberMax?: number;
}): number {
  const since = opts.now - 60_000;
  const own = opts.broadcastSentAt.filter((t) => t > since).length;
  const num = opts.numberSentAt.filter((t) => t > since).length;
  const byBroadcast = clampPerMinute(opts.perMinute) - own;
  const byNumber = (opts.numberMax ?? NUMBER_MAX_PER_MINUTE) - num;
  return Math.max(0, Math.min(byBroadcast, byNumber));
}

/** Pausa entre dos envíos del mismo lote, para no mandar en ráfaga (ms). */
export function sendGapMs(perMinute: number): number {
  return Math.min(3000, Math.floor(60_000 / clampPerMinute(perMinute) / 4));
}

/**
 * Variables del mensaje: {{name}}, {{phone}}, {{prop.<clave>}} y las que se
 * pasen. Las desconocidas quedan vacías.
 */
export function renderVariables(template: string, vars: Record<string, string>): string {
  const out = String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
  // Una variable vacía no deja espacios dobles ni espacios antes de la puntuación o el fin de línea.
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '');
}

export function chatVariables(chat: { name: string; phone: string; properties: Record<string, unknown> }): Record<string, string> {
  const vars: Record<string, string> = { name: chat.name ?? '', phone: chat.phone ? `+${chat.phone}` : '' };
  const first = (chat.name ?? '').trim().split(/\s+/)[0] ?? '';
  vars.first_name = first;
  for (const [k, v] of Object.entries(chat.properties ?? {})) {
    vars[`prop.${k}`] = v == null ? '' : Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'object' ? String((v as { name?: unknown }).name ?? '') : String(v);
  }
  return vars;
}
