/**
 * Groups: la interfaz común de los proveedores de WhatsApp. Cada número del
 * workspace usa uno:
 *
 * - `cloud`: WhatsApp Cloud API de Meta (oficial). Chats 1:1, plantillas y
 *   media. No gestiona grupos (lib/groups-provider-cloud.ts).
 * - `waha` / `evolution`: un gateway HTTP open source autoalojado (WAHA o
 *   Evolution API) que abre una sesión de WhatsApp Web por QR. Es lo que
 *   permite crear grupos y manejar miembros (lib/groups-provider-bridge.ts).
 * - `fake`: proveedor en memoria para tests y demo, solo con GROUPS_FAKE=1 y
 *   NODE_ENV=test o DEMO_MODE=true (lib/groups-provider-fake.ts).
 *
 * Los adaptadores reciben un `fetch` inyectable (tests con HTTP simulado) y
 * nunca incluyen credenciales en los errores: ProviderError lleva un código
 * corto y, a lo sumo, el status HTTP del proveedor.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type ProviderKind = 'cloud' | 'waha' | 'evolution' | 'fake';
export const PROVIDER_KINDS: readonly ProviderKind[] = ['cloud', 'waha', 'evolution', 'fake'];

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudConfig {
  phoneNumberId: string;
  accessToken: string;
  /** Firma de los webhooks (X-Hub-Signature-256). */
  appSecret: string;
  /** Token que Meta manda en la verificación GET del webhook. */
  verifyToken: string;
  /** WhatsApp Business Account: para listar plantillas. */
  wabaId?: string;
  apiVersion?: string;
}

export interface BridgeConfig {
  baseUrl: string;
  apiKey: string;
  /** Nombre de la sesión (WAHA) o de la instancia (Evolution). */
  session: string;
}

export type ProviderConfig = Partial<CloudConfig & BridgeConfig>;

export interface ProviderCaps {
  /** Crear grupos, miembros, admins, links de invitación. */
  groups: boolean;
  /** Conexión por QR (sesión de WhatsApp Web). */
  qr: boolean;
  /** Plantillas aprobadas por Meta (fuera de la ventana de 24 h). */
  templates: boolean;
  /** Encuestas nativas de WhatsApp (la Cloud API de Meta no las tiene). */
  polls: boolean;
}

export const PROVIDER_CAPS: Record<ProviderKind, ProviderCaps> = {
  cloud: { groups: false, qr: false, templates: true, polls: false },
  waha: { groups: true, qr: true, templates: false, polls: true },
  evolution: { groups: true, qr: true, templates: false, polls: true },
  fake: { groups: true, qr: true, templates: false, polls: true },
};

export type ConnectStatus = 'pending' | 'qr' | 'connected' | 'disconnected' | 'error';

export interface ConnectState {
  status: ConnectStatus;
  /** QR como data URL (image/png) o texto crudo para dibujar. */
  qr?: string;
  phone?: string;
}

export interface SendResult {
  id: string;
}

export type MemberRole = 'member' | 'admin' | 'superadmin';

export interface Participant {
  phone: string;
  role: MemberRole;
  name?: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  description?: string;
  participants?: Participant[];
  inviteLink?: string;
}

export type ParticipantAction = 'add' | 'remove' | 'promote' | 'demote';

export interface ParticipantResult {
  phone: string;
  ok: boolean;
  error?: string;
}

export interface MediaInput {
  url: string;
  mimetype: string;
  filename: string;
  caption?: string;
}

export interface Template {
  name: string;
  language: string;
  status: string;
  body: string;
}

export type InboundEvent =
  | {
      type: 'message';
      chatId: string;
      isGroup: boolean;
      chatName?: string;
      fromMe: boolean;
      senderPhone: string;
      senderName: string;
      providerMessageId: string;
      body: string;
      media?: { url: string; type: string; name: string };
      replyToProviderId?: string;
      timestamp?: string;
    }
  | {
      type: 'reaction';
      chatId: string;
      targetProviderMessageId: string;
      emoji: string;
      senderPhone: string;
      senderName: string;
      fromMe: boolean;
    }
  | { type: 'status'; providerMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed' }
  | {
      type: 'poll_vote';
      chatId: string;
      /** Id del mensaje de la encuesta en el proveedor. */
      pollProviderMessageId: string;
      voterPhone: string;
      voterName: string;
      /** Opciones elegidas (nombres o índices); vacío = sacó su voto. */
      options: Array<string | number>;
    }
  | { type: 'participants'; chatId: string; action: ParticipantAction; phones: string[] }
  | { type: 'session'; status: ConnectStatus; qr?: string; phone?: string };

export interface WebhookRequest {
  headers: Headers;
  rawBody: string;
}

export interface GroupsProvider {
  readonly kind: ProviderKind;
  readonly caps: ProviderCaps;
  /** Arranca la sesión (o valida las credenciales) y registra el webhook. */
  connect(webhookUrl: string): Promise<ConnectState>;
  state(): Promise<ConnectState>;
  disconnect(): Promise<void>;
  sendText(chatId: string, text: string, opts?: { replyTo?: string }): Promise<SendResult>;
  sendMedia(chatId: string, media: MediaInput): Promise<SendResult>;
  react(chatId: string, providerMessageId: string, emoji: string, fromMe: boolean): Promise<void>;
  sendTemplate(chatId: string, name: string, language: string, params: string[]): Promise<SendResult>;
  /** Encuesta nativa (solo si caps.polls). */
  sendPoll?(chatId: string, poll: { question: string; options: string[]; multi: boolean }): Promise<SendResult>;
  listTemplates(): Promise<Template[]>;
  listGroups(): Promise<GroupInfo[]>;
  createGroup(name: string, phones: string[]): Promise<GroupInfo>;
  participants(groupId: string): Promise<Participant[]>;
  updateParticipants(groupId: string, action: ParticipantAction, phones: string[]): Promise<ParticipantResult[]>;
  inviteLink(groupId: string, revoke?: boolean): Promise<string>;
  updateGroup(groupId: string, patch: { name?: string; description?: string }): Promise<void>;
  /** Firma o token del webhook. `secret` es el del número (va en la URL). */
  verifyWebhook(req: WebhookRequest, secret: string): boolean;
  parseWebhook(body: unknown): InboundEvent[];
}

export type ProviderErrorCode =
  | 'unsupported'
  | 'auth_failed'
  | 'not_connected'
  | 'not_found'
  | 'invalid_config'
  | 'invalid_phone'
  | 'rate_limited'
  | 'provider_error'
  | 'unreachable';

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    public httpStatus?: number,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

/** Status HTTP del proveedor → código nuestro (sin leer ni repetir el cuerpo). */
export function errorFromStatus(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth_failed', status);
  if (status === 404) return new ProviderError('not_found', status);
  if (status === 429) return new ProviderError('rate_limited', status);
  return new ProviderError('provider_error', status);
}

// ---------- Helpers compartidos ----------

/** Solo dígitos: "+54 9 11 5555-0000" → "5491155550000". */
export function phoneDigits(raw: string): string {
  return String(raw ?? '').replace(/@.*$/, '').replace(/[^\d]/g, '');
}

/** Número válido para WhatsApp (E.164 sin "+": 8 a 15 dígitos). */
export function isValidPhone(raw: string): boolean {
  const d = phoneDigits(raw);
  return d.length >= 8 && d.length <= 15;
}

/** "123-456@g.us" o "1203630...@g.us" → grupo. */
export function isGroupJid(id: string): boolean {
  return /@g\.us$/.test(id);
}

/** Comparación en tiempo constante de dos strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** HMAC hex de `body` con `key`. */
export function hmacHex(algo: 'sha256' | 'sha512', key: string, body: string): string {
  return createHmac(algo, key).update(body, 'utf8').digest('hex');
}

/**
 * Teléfonos pegados → uno por elemento. Separan comas, punto y coma y saltos
 * de línea; los espacios solo separan si el pedazo tiene más dígitos que un
 * teléfono ("+1 555 000 1001" es uno, "+15550001001 +15550002002" son dos).
 */
export function splitPhones(raw: string | string[]): string[] {
  const chunks = (Array.isArray(raw) ? raw : [raw]).flatMap((r) => String(r ?? '').split(/[\n,;|]+/));
  const out: string[] = [];
  for (const c of chunks) {
    const t = c.trim();
    if (!t) continue;
    if (phoneDigits(t).length > 15) out.push(...t.split(/\s+/).filter(Boolean));
    else out.push(t);
  }
  return out;
}

/** Lista de teléfonos pegada (comas, espacios, saltos, punto y coma) → dígitos únicos. */
export function parsePhoneList(raw: string | string[]): { valid: string[]; invalid: string[] } {
  const parts = splitPhones(raw);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (isValidPhone(p)) {
      const d = phoneDigits(p);
      if (!valid.includes(d)) valid.push(d);
    } else invalid.push(p);
  }
  return { valid, invalid };
}

export function unsupported(): never {
  throw new ProviderError('unsupported');
}
