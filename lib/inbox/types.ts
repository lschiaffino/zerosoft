/**
 * Inbox: tipos y funciones puras (sin base ni red). Las comparte el cliente.
 */

export type InboxChannel = 'whatsapp' | 'gmail';
export type ThreadKind = 'dm' | 'group' | 'email';
export type AccountStatus = 'disconnected' | 'pending' | 'qr' | 'connected' | 'error';

/** Vistas fijas de la barra (como los splits de Superhuman). Las carpetas propias van aparte. */
export const INBOX_VIEWS = ['inbox', 'unread', 'reply', 'waiting', 'whatsapp', 'email', 'groups', 'pinned', 'snoozed', 'scheduled', 'done', 'archived'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export function isInboxView(v: unknown): v is InboxView {
  return typeof v === 'string' && (INBOX_VIEWS as readonly string[]).includes(v);
}

/** Hace cuánto se espera respuesta para que un chat cuente como "esperando" (mandaste y no contestaron). */
export const WAITING_AFTER_MS = 24 * 60 * 60 * 1000;

export class InboxError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface InboxAccountDto {
  id: string;
  kind: InboxChannel;
  label: string;
  address: string;
  status: AccountStatus;
  error: string;
  lastSyncAt: string | null;
  /** Hay importación del historial de WhatsApp en curso. */
  backfilling: boolean;
}

export interface ThreadDto {
  id: string;
  accountId: string;
  channel: InboxChannel;
  kind: ThreadKind;
  title: string;
  handle: string;
  preview: string;
  lastMessageAt: string | null;
  lastFromMe: boolean;
  unread: number;
  pinned: boolean;
  done: boolean;
  /** Archivado (como WhatsApp): fuera de la bandeja, en "Archivados". */
  archived: boolean;
  snoozedUntil: string | null;
  woke: '' | 'snooze' | 'followup';
  followUpAt: string | null;
  mutedUntil: string | null;
  draft: string;
  folderIds: string[];
  scheduledCount: number;
  /** WhatsApp: link a la foto ('' sin foto). */
  avatar: string;
  /** Quién mandó el último mensaje en un grupo (para "Ana: hola"). */
  lastSender: string;
  /** Tipo de media del último mensaje (image, video, audio, voice, document, sticker, location, contact, poll). */
  lastKind: string;
  /** Tildes del último mensaje propio (sent, delivered, read, failed). */
  lastStatus: string;
  presence: '' | 'typing' | 'recording' | 'online';
  /** En un grupo, quién escribe (teléfono). */
  presenceWho: string;
  lastSeenAt: string | null;
  /** Último mensaje con foto o video (su miniatura en la fila). */
  lastMediaId?: string | null;
}

/** Datos de presentación de un mensaje de WhatsApp (los que manda el servidor). */
export interface WaMessageMeta {
  width?: number;
  height?: number;
  /** Segundos (audio, nota de voz, video). */
  duration?: number;
  /** Nota de voz. */
  ptt?: boolean;
  pages?: number;
  size?: number;
  mime?: string;
  /** Miniatura chica (data URL). */
  thumb?: string;
  viewOnce?: boolean;
  animated?: boolean;
  /** Forma de onda de la nota de voz (0 a 100). */
  waveform?: number[];
  location?: { lat: number; lng: number; name?: string; address?: string; url?: string; live?: boolean };
  contacts?: Array<{ name: string; phones: string[] }>;
  poll?: { question: string; options: string[]; multi: boolean };
  /** Vista previa del link (título, descripción, miniatura). */
  link?: { url: string; title: string; description?: string; thumb?: string };
}

export interface ParticipantDto {
  phone: string;
  role: 'member' | 'admin' | 'superadmin';
  name: string;
  /** Chat 1:1 con esa persona en Inbox (para abrirlo). */
  threadId: string | null;
  avatar: string;
  me: boolean;
}

/** Info del contacto o del grupo (panel de la derecha y subtítulo de la cabecera). */
export interface WaDetailsDto {
  /** "Info" del contacto o descripción del grupo. */
  about: string;
  size: number;
  createdAt: string | null;
  isBusiness: boolean;
  /** Mi número (para "Vos" en la lista de participantes). */
  myPhone: string;
  participants: ParticipantDto[];
  infoAt: string | null;
  /** Bloqueado desde Inbox. */
  blocked?: boolean;
  /** Grupos en común (chat 1:1). */
  commonGroups?: Array<{ id: string; title: string; avatar: string }>;
}

export interface MessageReaction {
  emoji: string;
  /** Teléfono de quien reaccionó ('me' si fui yo). */
  by: string;
  name: string;
}

export interface MessageQuote {
  id: string;
  fromMe: boolean;
  senderName: string;
  senderHandle: string;
  body: string;
  mediaType: string;
}

export interface MessageDto {
  id: string;
  fromMe: boolean;
  senderName: string;
  senderHandle: string;
  subject: string;
  body: string;
  emailTo: string;
  mediaType: string;
  mediaName: string;
  hasMedia: boolean;
  status: string;
  edited: boolean;
  revoked: boolean;
  sentAt: string;
  /** Mensaje citado (respuesta), si se encuentra en el chat. */
  reply?: MessageQuote | null;
  reactions?: MessageReaction[];
  forwarded?: boolean;
  starred?: boolean;
  meta?: WaMessageMeta | null;
}

export interface FolderRule {
  channel?: InboxChannel;
  kind?: ThreadKind;
  /** Texto que tiene que aparecer en el nombre, el teléfono o el email. */
  from?: string;
}

export interface FolderDto {
  id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
  parentId: string | null;
  rule: FolderRule | null;
  /** Chats sin leer de la carpeta y sus subcarpetas (sin repetir). */
  count: number;
  /** Chats sin leer de la carpeta sola. */
  ownCount: number;
}

export interface SnippetDto {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

export type ScheduledStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'missed' | 'cancelled';

export interface ScheduledDto {
  id: string;
  threadId: string;
  threadTitle: string;
  channel: InboxChannel;
  body: string;
  sendAt: string;
  status: ScheduledStatus;
  error: string;
  /** Envío de varios mensajes al que pertenece (el id propio si es uno solo). */
  batchId: string;
  /** Orden dentro del envío (0 = el primero). */
  seq: number;
  /** Espera después del mensaje anterior, en segundos. */
  delaySec: number;
  /** Archivo que sale con el mensaje ('' sin archivo); el texto va como pie. */
  mediaName: string;
  mediaType: string;
  mediaUrl: string;
}

export const FOLDER_COLORS = ['#3d5a80', '#0e9f6e', '#7b4dff', '#e23d7f', '#c2700a', '#0284c7', '#6b7280', '#b91c1c'] as const;

export const LIMITS = {
  folderName: 60,
  snippetTitle: 80,
  snippetShortcut: 24,
  snippetBody: 5000,
  message: 8000,
  notes: 20_000,
  draft: 8000,
  searchQuery: 200,
  folders: 200,
  snippets: 500,
} as const;

/** Texto plano corto para la vista previa de la lista. */
export function previewOf(body: string, mediaType = ''): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  if (clean) return clean.slice(0, 160);
  return mediaType ? `[${mediaType}]` : '';
}

/** "5491155550000@s.whatsapp.net" o "...@c.us" → "5491155550000@s.whatsapp.net". Grupos y lids quedan igual. */
export function normalizeWaJid(raw: string): string {
  const id = String(raw ?? '').trim();
  if (/@c\.us$/i.test(id)) return id.replace(/@c\.us$/i, '@s.whatsapp.net');
  return id;
}

export function waKindOf(jid: string): ThreadKind {
  return /@g\.us$/i.test(jid) ? 'group' : 'dm';
}

/** Dígitos del teléfono de un jid de persona ('' en grupos y lids). */
export function waPhoneOf(jid: string): string {
  const m = /^(\d{6,16})@(s\.whatsapp\.net|c\.us)$/i.exec(jid);
  return m ? m[1] : '';
}

/** ¿La regla de una carpeta incluye este chat? Sin regla, solo los que se agregaron a mano. */
export function ruleMatches(rule: FolderRule | null, t: { channel: InboxChannel; kind: ThreadKind; title: string; handle: string }): boolean {
  if (!rule) return false;
  const keys = Object.values(rule).filter((v) => v !== undefined && v !== '');
  if (!keys.length) return false;
  if (rule.channel && rule.channel !== t.channel) return false;
  if (rule.kind && rule.kind !== t.kind) return false;
  if (rule.from) {
    const needle = foldText(rule.from);
    if (!foldText(`${t.title} ${t.handle}`).includes(needle)) return false;
  }
  return true;
}

/** Minúsculas y sin tildes, para buscar como en WhatsApp. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function parseRule(raw: unknown): FolderRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: FolderRule = {};
  if (r.channel === 'whatsapp' || r.channel === 'gmail') out.channel = r.channel;
  if (r.kind === 'dm' || r.kind === 'group' || r.kind === 'email') out.kind = r.kind;
  if (typeof r.from === 'string' && r.from.trim()) out.from = r.from.trim().slice(0, 80);
  return Object.keys(out).length ? out : null;
}

/** Atajo de un snippet: letras, números y guiones, sin espacios ("gracias", "cbu"). */
export function cleanShortcut(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[;/]+/, '')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, LIMITS.snippetShortcut);
}

/**
 * Variables de un snippet: {nombre} y {primer_nombre} con el nombre del chat.
 * {first_name} y {primeiro_nome} también funcionan.
 */
export function fillSnippet(body: string, chatTitle: string): string {
  const name = chatTitle.trim();
  const first = name.split(/\s+/)[0] ?? '';
  return body
    .replace(/\{(nombre|name|nome)\}/gi, name)
    .replace(/\{(primer_nombre|first_name|primeiro_nome)\}/gi, first);
}

// Los presets de "cuándo" (posponer, recordar, enviar más tarde) son comunes a
// Inbox y Lines: viven en lib/when-presets.ts.
export { presetDate, SNOOZE_PRESETS, type SnoozePreset } from '../when-presets';

/** Atajos de teclado (como Superhuman). Se muestran en la ayuda (?) y en Ajustes. */
export const SHORTCUTS: ReadonlyArray<{ keys: string; id: string }> = [
  { keys: 'j / k', id: 'navigate' },
  { keys: 'Enter', id: 'open' },
  { keys: 'Esc', id: 'back' },
  { keys: 'e', id: 'done' },
  { keys: '⇧E', id: 'undone' },
  { keys: 'h', id: 'snooze' },
  { keys: 'f', id: 'followUp' },
  { keys: 'r', id: 'reply' },
  { keys: 'c', id: 'compose' },
  { keys: 'u', id: 'unread' },
  { keys: 'p', id: 'pin' },
  { keys: 'v', id: 'moveFolder' },
  { keys: '/', id: 'search' },
  { keys: 'g i / g d / g s', id: 'goto' },
  { keys: '⌘J', id: 'ai' },
  { keys: ';', id: 'snippet' },
  { keys: '⌘Enter', id: 'send' },
  { keys: 'z', id: 'undo' },
  { keys: '?', id: 'help' },
];
