/**
 * Groups: adaptadores del modo puente. Hablan con un gateway HTTP open source
 * autoalojado que abre una sesión de WhatsApp Web por QR:
 *
 * - WAHA (https://waha.devlike.pro): header X-Api-Key, sesión por nombre,
 *   webhooks con HMAC SHA-512 opcional (X-Webhook-Hmac).
 * - Evolution API v2 (https://doc.evolution-api.com): header apikey, una
 *   instancia por número, webhook por instancia.
 *
 * Es la vía que permite grupos (crear, miembros, admins, links), con el
 * riesgo de una sesión no oficial: WhatsApp puede restringir el número.
 *
 * La URL del gateway pasa por safeFetch (sin hosts privados) salvo en
 * self-host con ALLOW_PRIVATE_WEBHOOKS=true. Los errores no llevan la key.
 */
import { readTextCapped, safeFetch, UnsafeUrlError } from './safe-fetch';
import {
  evolutionFileName,
  infoFromBaileys,
  locationFrom,
  parseVcard,
  planOutboundKind,
  type ContactCard,
  type LocationInfo,
  type MediaInfo,
} from './groups-media';
import {
  PROVIDER_CAPS,
  ProviderError,
  type CallStatus,
  errorFromStatus,
  hmacHex,
  isGroupJid,
  isLidJid,
  lidDigits,
  phoneDigits,
  safeEqual,
  type ArchiveRef,
  type BridgeConfig,
  type ChatInfo,
  type ConnectState,
  type ConnectStatus,
  type FetchedMedia,
  type FetchLike,
  type MediaRef,
  type GroupInfo,
  type GroupsProvider,
  type HistoryChat,
  type HistoryContact,
  type HistorySource,
  type InboundEvent,
  type LinkPreview,
  type MemberRole,
  type Participant,
  type ParticipantAction,
  type ParticipantResult,
  type ProviderKind,
  type WebhookRequest,
} from './groups-provider';

type Json = Record<string, unknown>;

export const defaultBridgeFetch: FetchLike = (url, init) => safeFetch(url, init, 15_000);
/**
 * Envíos de media: el gateway baja el archivo, lo convierte (JPEG, OGG/Opus,
 * WebP) y lo sube a WhatsApp antes de responder.
 */
export const mediaBridgeFetch: FetchLike = (url, init) => safeFetch(url, init, 90_000);

function baseOf(cfg: BridgeConfig): string {
  const base = String(cfg.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new ProviderError('invalid_config');
  return base;
}

/** Tope de una respuesta común del gateway (listas de grupos, estados, QR). */
export const BRIDGE_MAX_RESPONSE = 5 * 1024 * 1024;

export async function bridgeRequest(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  method: string,
  body?: unknown,
  opts: { maxBytes?: number } = {},
): Promise<unknown> {
  const maxBytes = opts.maxBytes ?? BRIDGE_MAX_RESPONSE;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { ...headers, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ProviderError('invalid_config');
    throw new ProviderError('unreachable');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw errorFromStatus(res.status);
  }
  // Se corta mientras se lee: ni el content-length ni el cuerpo pueden pasar el tope.
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new ProviderError('provider_error', 413);
  }
  const text = await readTextCapped(res, maxBytes + 1).catch(() => '');
  if (Buffer.byteLength(text) > maxBytes) throw new ProviderError('provider_error', 413);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function idString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  const o = (raw ?? {}) as Json;
  return String(o._serialized ?? o.id ?? '');
}

/**
 * Id de WhatsApp con teléfono a partir de un id que puede ser "@lid" (anónimo).
 * Evolution v2.3 (Baileys 7) manda el alternativo en remoteJidAlt /
 * participantAlt; versiones anteriores, en senderPn / participantPn. Si no hay
 * ninguno con teléfono, queda el lid (sirve de id, nunca de teléfono).
 */
export function pnJid(primary: string, ...alts: unknown[]): string {
  if (!isLidJid(primary)) return primary;
  for (const a of alts) {
    const v = typeof a === 'string' ? a.trim() : '';
    if (v && !isLidJid(v) && /@(s\.whatsapp\.net|c\.us)$/.test(v)) return v;
  }
  return primary;
}

/** Teléfono de un participante de grupo (string o { id, phoneNumber, jid, lid }), sin lids. */
function participantPhone(raw: unknown): string {
  if (typeof raw === 'string') return phoneDigits(raw);
  const o = (raw ?? {}) as Json;
  for (const k of ['phoneNumber', 'jid', 'id', '_serialized']) {
    const v = typeof o[k] === 'string' ? (o[k] as string) : '';
    const d = phoneDigits(v);
    if (d) return d;
  }
  return '';
}

/** Lid (dígitos) de un participante de grupo (string o { id, lid, jid }), '' si no trae. */
function participantLid(raw: unknown): string {
  if (typeof raw === 'string') return lidDigits(raw);
  const o = (raw ?? {}) as Json;
  for (const k of ['lid', 'id', 'jid', '_serialized']) {
    const d = lidDigits(typeof o[k] === 'string' ? (o[k] as string) : '');
    if (d) return d;
  }
  return '';
}

/** Primer lid (dígitos) entre varios ids posibles. */
function firstLid(...ids: unknown[]): string {
  for (const v of ids) {
    const d = typeof v === 'string' ? lidDigits(v) : '';
    if (d) return d;
  }
  return '';
}

/**
 * contextInfo.mentionedJid → cada id mencionado, sin repetir: los dígitos del
 * teléfono, o "<dígitos>@lid" para un lid (el texto trae "@<dígitos>" igual).
 */
export function mentionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const j of raw.slice(0, 100)) {
    const s = typeof j === 'string' ? j : '';
    const lid = lidDigits(s);
    const id = lid ? `${lid}@lid` : phoneDigits(s);
    const d = lid || id;
    if (d && d.length >= 5 && d.length <= 20 && !out.includes(id)) out.push(id);
  }
  return out;
}

/** fileLength de Baileys: número, string o Long { low, high }. */
function byteLength(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return Number(raw) || 0;
  const o = (raw ?? {}) as { low?: number; high?: number };
  return typeof o.low === 'number' ? (o.low >>> 0) + (o.high ?? 0) * 2 ** 32 : 0;
}

/** Tope de lo que se baja de un archivo recibido (el de WhatsApp para fotos, video y audio). */
export const MAX_INBOUND_MEDIA = 16 * 1024 * 1024;

function roleOf(raw: unknown): MemberRole {
  const r = String(raw ?? '').toLowerCase();
  if (r === 'superadmin') return 'superadmin';
  if (r === 'admin' || r === 'true') return 'admin';
  return 'member';
}

/** announce / restrict de la metadata del grupo (WAHA y Evolution usan los nombres de WhatsApp). */
function flagsOf(g: Json): { announce?: boolean; locked?: boolean } {
  const out: { announce?: boolean; locked?: boolean } = {};
  if (typeof g.announce === 'boolean') out.announce = g.announce;
  if (typeof g.restrict === 'boolean') out.locked = g.restrict;
  return out;
}

/** Tipo de media corto a partir del mimetype o del tipo de mensaje. */
function shortType(mime: string): string {
  return mime || 'file';
}

// ======================================================================
// WAHA
// ======================================================================

const WAHA_EVENTS = [
  'message.any',
  'message.reaction',
  'message.ack',
  'message.edited',
  'message.revoked',
  'session.status',
  'group.v2.participants',
  'call.received',
  'call.accepted',
  'call.rejected',
  'poll.vote',
];

function wahaStatus(raw: unknown): ConnectStatus {
  switch (String(raw ?? '').toUpperCase()) {
    case 'WORKING':
      return 'connected';
    case 'SCAN_QR_CODE':
      return 'qr';
    case 'STARTING':
      return 'pending';
    case 'FAILED':
      return 'error';
    default:
      return 'disconnected';
  }
}

const WAHA_ACK: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
  SERVER: 'sent',
  DEVICE: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  ERROR: 'failed',
};

/** Webhook de WAHA → eventos normalizados. */
export function parseWahaWebhook(body: unknown): InboundEvent[] {
  const b = (body ?? {}) as Json;
  const event = String(b.event ?? '');
  const p = (b.payload ?? {}) as Json;
  const data = (p._data ?? {}) as Json;
  switch (event) {
    case 'message':
    case 'message.any': {
      const fromMe = p.fromMe === true;
      const chatId = String(fromMe ? p.to ?? '' : p.from ?? '');
      const id = String(p.id ?? '');
      if (!chatId || !id || chatId === 'status@broadcast') return [];
      const isGroup = isGroupJid(chatId);
      const sender = isGroup ? String(p.participant ?? data.author ?? '') : fromMe ? '' : chatId;
      const media = p.hasMedia && p.media ? (p.media as Json) : null;
      const ts = Number(p.timestamp);
      return [
        {
          type: 'message',
          chatId,
          isGroup,
          fromMe,
          senderPhone: phoneDigits(sender),
          senderName: String(data.notifyName ?? p.notifyName ?? ''),
          providerMessageId: id,
          body: String(p.body ?? ''),
          media: media
            ? { url: media.url ? `bridge:${String(media.url)}` : '', type: shortType(String(media.mimetype ?? '')), name: String(media.filename ?? '') }
            : undefined,
          replyToProviderId: p.replyTo ? idString((p.replyTo as Json).id ?? p.replyTo) || undefined : undefined,
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : undefined,
        },
      ];
    }
    case 'message.reaction': {
      const r = (p.reaction ?? {}) as Json;
      const fromMe = p.fromMe === true;
      const chatId = String(fromMe ? p.to ?? p.from ?? '' : p.from ?? '');
      if (!chatId || !r.messageId) return [];
      return [
        {
          type: 'reaction',
          chatId,
          targetProviderMessageId: String(r.messageId),
          emoji: String(r.text ?? ''),
          senderPhone: phoneDigits(String(p.participant ?? (isGroupJid(chatId) ? '' : chatId))),
          senderName: String(data.notifyName ?? ''),
          fromMe,
          ...(Number(p.timestamp) > 0 ? { at: new Date(Number(p.timestamp) * 1000).toISOString() } : {}),
        },
      ];
    }
    case 'message.edited': {
      const target = String(p.editedMessageId ?? '');
      const chatId = String(p.fromMe === true ? p.to ?? '' : p.from ?? '');
      if (!target || !chatId) return [];
      const ets = Number(p.timestamp);
      return [{ type: 'edit', chatId, providerMessageId: target, body: String(p.body ?? ''), ...(Number.isFinite(ets) && ets > 0 ? { at: new Date(ets * 1000).toISOString() } : {}) }];
    }
    case 'message.revoked': {
      const ref = ((p.after ?? p.before ?? {}) as Json) ?? {};
      const target = String(p.revokedMessageId ?? ((p.before ?? {}) as Json).id ?? '');
      const chatId = String(ref.fromMe === true ? ref.to ?? '' : ref.from ?? '');
      if (!target || !chatId) return [];
      return [{ type: 'revoke', chatId, providerMessageId: target }];
    }
    case 'call.received':
    case 'call.accepted':
    case 'call.rejected': {
      const chatId = String(p.from ?? '');
      if (!p.id || !chatId || isGroupJid(chatId)) return [];
      const status = event === 'call.received' ? 'ringing' : event === 'call.accepted' ? 'answered' : 'rejected';
      const ts = Number(p.timestamp);
      return [
        {
          type: 'call',
          chatId,
          callId: String(p.id),
          direction: 'in',
          status,
          senderPhone: phoneDigits(chatId),
          isVideo: p.isVideo === true,
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : undefined,
        },
      ];
    }
    case 'message.ack': {
      const st = WAHA_ACK[String(p.ackName ?? '').toUpperCase()];
      if (!st || !p.id) return [];
      return [{ type: 'status', providerMessageId: String(p.id), status: st }];
    }
    case 'session.status': {
      const me = (p.me ?? (b.me as Json) ?? {}) as Json;
      return [{ type: 'session', status: wahaStatus(p.status), phone: me.id ? phoneDigits(String(me.id)) : undefined }];
    }
    case 'poll.vote': {
      // { vote: { from, to, participant?, fromMe, selectedOptions }, poll: { id, to, from } }
      const vote = (p.vote ?? {}) as Json;
      const poll = (p.poll ?? {}) as Json;
      const pollId = idString(poll.id);
      const chatId = String(poll.fromMe === false ? poll.from ?? '' : poll.to ?? vote.to ?? '');
      if (!pollId || vote.fromMe === true) return [];
      const voter = String(vote.participant ?? (isGroupJid(String(vote.from ?? '')) ? '' : vote.from) ?? '');
      return [
        {
          type: 'poll_vote',
          chatId: chatId || String(vote.to ?? ''),
          pollProviderMessageId: pollId,
          voterPhone: phoneDigits(voter),
          voterName: String(((vote._data ?? {}) as Json).notifyName ?? ''),
          options: Array.isArray(vote.selectedOptions) ? (vote.selectedOptions as Array<string | number>) : [],
        },
      ];
    }
    case 'group.v2.participants': {
      const group = (p.group ?? {}) as Json;
      const map: Record<string, ParticipantAction> = { join: 'add', leave: 'remove', promote: 'promote', demote: 'demote' };
      const action = map[String(p.type ?? '')];
      const parts = Array.isArray(p.participants) ? (p.participants as Json[]) : [];
      if (!action || !group.id) return [];
      return [{ type: 'participants', chatId: String(group.id), action, phones: parts.map((x) => phoneDigits(idString(x.id ?? x))) }];
    }
    default:
      return [];
  }
}

/** HMAC de WAHA (si el gateway lo manda): X-Webhook-Hmac = HMAC-SHA512(body, secret). */
export function verifyWahaHmac(req: WebhookRequest, secret: string): boolean {
  const header = req.headers.get('x-webhook-hmac');
  // Sin HMAC: alcanza con el secreto de la URL (lo valida la ruta antes).
  if (!header) return true;
  return safeEqual(header.trim().toLowerCase(), hmacHex('sha512', secret, req.rawBody));
}

export function wahaProvider(
  cfg: BridgeConfig,
  opts: { fetch?: FetchLike; webhookSecret?: string } = {},
): GroupsProvider {
  const f = opts.fetch ?? defaultBridgeFetch;
  const session = encodeURIComponent(cfg.session || 'default');
  const headers = { 'x-api-key': cfg.apiKey ?? '' };
  const api = (path: string, method = 'GET', body?: unknown) => bridgeRequest(f, `${baseOf(cfg)}${path}`, headers, method, body);
  const jid = (phone: string) => `${phoneDigits(phone)}@c.us`;
  const gid = (id: string) => encodeURIComponent(id);

  async function state(): Promise<ConnectState> {
    const s = (await api(`/api/sessions/${session}`)) as Json;
    const status = wahaStatus(s.status);
    const me = (s.me ?? {}) as Json;
    const out: ConnectState = { status, phone: me.id ? phoneDigits(String(me.id)) : undefined };
    if (status === 'qr') {
      const qr = (await api(`/api/${session}/auth/qr?format=image`).catch(() => null)) as Json | null;
      if (qr?.data) out.qr = `data:${String(qr.mimetype ?? 'image/png')};base64,${String(qr.data)}`;
    }
    return out;
  }

  async function participantCall(groupId: string, path: string, phones: string[]): Promise<ParticipantResult[]> {
    await api(`/api/${session}/groups/${gid(groupId)}/${path}`, 'POST', { participants: phones.map((p) => ({ id: jid(p) })) });
    return phones.map((phone) => ({ phone, ok: true }));
  }

  return {
    kind: 'waha',
    caps: PROVIDER_CAPS.waha,
    async connect(webhookUrl) {
      const config = {
        webhooks: [
          {
            url: webhookUrl,
            events: WAHA_EVENTS,
            ...(opts.webhookSecret ? { hmac: { key: opts.webhookSecret } } : {}),
          },
        ],
      };
      try {
        await api('/api/sessions', 'POST', { name: cfg.session || 'default', start: true, config });
      } catch (err) {
        // Ya existe: se actualiza el webhook y se arranca.
        if (!(err instanceof ProviderError) || (err.httpStatus !== 409 && err.httpStatus !== 422)) throw err;
        await api(`/api/sessions/${session}`, 'PUT', { name: cfg.session || 'default', config });
        await api(`/api/sessions/${session}/start`, 'POST').catch(() => null);
      }
      return state();
    },
    state,
    async disconnect() {
      await api(`/api/sessions/${session}/logout`, 'POST').catch(() => null);
    },
    async sendText(chatId, text, o) {
      const r = (await api('/api/sendText', 'POST', {
        session: cfg.session || 'default',
        chatId,
        text,
        ...(o?.replyTo ? { reply_to: o.replyTo } : {}),
      })) as Json;
      return { id: idString(r.id) || String((r.key as Json | undefined)?.id ?? '') };
    },
    async sendMedia(chatId, media) {
      const path = media.mimetype.startsWith('image/') ? '/api/sendImage' : media.mimetype.startsWith('video/') ? '/api/sendVideo' : '/api/sendFile';
      const r = (await api(path, 'POST', {
        session: cfg.session || 'default',
        chatId,
        file: { mimetype: media.mimetype, filename: media.filename, url: media.url },
        caption: media.caption ?? '',
      })) as Json;
      return { id: idString(r.id) };
    },
    async react(_chatId, messageId, emoji) {
      await api('/api/reaction', 'PUT', { session: cfg.session || 'default', messageId, reaction: emoji });
    },
    async sendPoll(chatId, poll) {
      const r = (await api('/api/sendPoll', 'POST', {
        session: cfg.session || 'default',
        chatId,
        poll: { name: poll.question, options: poll.options, multipleAnswers: poll.multi },
      })) as Json;
      return { id: idString(r.id) || String((r.key as Json | undefined)?.id ?? '') };
    },
    sendTemplate: async () => {
      throw new ProviderError('unsupported');
    },
    listTemplates: async () => [],
    async listGroups() {
      const rows = (await api(`/api/${session}/groups`)) as unknown;
      const list = Array.isArray(rows) ? (rows as Json[]) : Object.values((rows ?? {}) as Record<string, Json>);
      return list
        .map((g) => ({
          id: idString(g.id ?? g.JID),
          name: String(g.subject ?? g.name ?? g.Name ?? ''),
          description: String(g.description ?? g.desc ?? ''),
          ...flagsOf(g),
        }))
        .filter((g) => isGroupJid(g.id));
    },
    async createGroup(name, phones) {
      const r = (await api(`/api/${session}/groups`, 'POST', { name, participants: phones.map((p) => ({ id: jid(p) })) })) as Json;
      const id = idString(r.gid ?? r.id ?? r.JID);
      if (!id) throw new ProviderError('provider_error');
      return { id, name };
    },
    async participants(groupId): Promise<Participant[]> {
      const rows = (await api(`/api/${session}/groups/${gid(groupId)}/participants`)) as Json[];
      return (Array.isArray(rows) ? rows : [])
        .filter((p) => String(p.role ?? '') !== 'left')
        .map((p) => ({ phone: phoneDigits(idString(p.id)), role: p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : roleOf(p.role) }));
    },
    updateParticipants(groupId, action, phones) {
      const path = { add: 'participants/add', remove: 'participants/remove', promote: 'admin/promote', demote: 'admin/demote' }[action];
      return participantCall(groupId, path, phones);
    },
    async inviteLink(groupId, revoke) {
      const r = await api(`/api/${session}/groups/${gid(groupId)}/invite-code${revoke ? '/revoke' : ''}`, revoke ? 'POST' : 'GET');
      const code = typeof r === 'string' ? r : String((r as Json).code ?? (r as Json).inviteCode ?? '');
      if (!code) throw new ProviderError('provider_error');
      return code.startsWith('http') ? code : `https://chat.whatsapp.com/${code}`;
    },
    async updateGroup(groupId, patch) {
      if (patch.name !== undefined) await api(`/api/${session}/groups/${gid(groupId)}/subject`, 'PUT', { subject: patch.name });
      if (patch.description !== undefined)
        await api(`/api/${session}/groups/${gid(groupId)}/description`, 'PUT', { description: patch.description });
    },
    async editMessage(chatId, messageId, text) {
      await api(`/api/${session}/chats/${gid(chatId)}/messages/${gid(messageId)}`, 'PUT', { text });
    },
    async deleteMessage(chatId, messageId) {
      await api(`/api/${session}/chats/${gid(chatId)}/messages/${gid(messageId)}`, 'DELETE');
    },
    async pinMessage(chatId, messageId, pin) {
      // WhatsApp pide una duración: 30 días (lo máximo). Desfijar no lleva cuerpo.
      await api(`/api/${session}/chats/${gid(chatId)}/messages/${gid(messageId)}/${pin ? 'pin' : 'unpin'}`, 'POST', pin ? { duration: 2592000 } : undefined);
    },
    async forwardMessage(toChatId, _fromChatId, messageId) {
      const r = (await api('/api/forwardMessage', 'POST', { session: cfg.session || 'default', chatId: toChatId, messageId })) as Json;
      return { id: idString(r.id) || String((r.key as Json | undefined)?.id ?? '') };
    },
    async updateGroupSettings(groupId, patch) {
      const base = `/api/${session}/groups/${gid(groupId)}/settings/security`;
      if (patch.locked !== undefined) await api(`${base}/info-admin-only`, 'PUT', { adminsOnly: patch.locked });
      if (patch.announce !== undefined) await api(`${base}/messages-admin-only`, 'PUT', { adminsOnly: patch.announce });
      // WAHA no expone los mensajes temporales de un grupo.
      if (patch.ephemeral !== undefined) throw new ProviderError('unsupported');
    },
    async setGroupPicture(groupId, image) {
      const path = `/api/${session}/groups/${gid(groupId)}/picture`;
      if (!image) await api(path, 'DELETE');
      else await api(path, 'PUT', { file: { url: image.url, mimetype: image.mimetype } });
    },
    async joinGroup(code) {
      const r = (await api(`/api/${session}/groups/join`, 'POST', { code })) as Json;
      const id = idString(r.id ?? r.gid ?? r.groupId);
      if (!id) throw new ProviderError('provider_error');
      return { id };
    },
    async leaveGroup(groupId) {
      await api(`/api/${session}/groups/${gid(groupId)}/leave`, 'POST');
    },
    verifyWebhook: verifyWahaHmac,
    parseWebhook: parseWahaWebhook,
  };
}

// ======================================================================
// Evolution API v2
// ======================================================================

export const EVOLUTION_EVENTS = [
  'MESSAGES_SET',
  'CONTACTS_UPSERT',
  'CHATS_SET',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'CONNECTION_UPDATE',
  'PRESENCE_UPDATE',
  'QRCODE_UPDATED',
  'GROUP_PARTICIPANTS_UPDATE',
  'CALL',
];

/** Estado de una llamada de Baileys (evento CALL de Evolution) → el nuestro. */
const EVOLUTION_CALL: Record<string, CallStatus> = {
  offer: 'ringing',
  ringing: 'ringing',
  accept: 'answered',
  timeout: 'missed',
  reject: 'rejected',
  terminate: 'ended',
};

function evolutionStatus(raw: unknown): ConnectStatus {
  switch (String(raw ?? '').toLowerCase()) {
    case 'open':
      return 'connected';
    case 'connecting':
      return 'qr';
    case 'close':
      return 'disconnected';
    default:
      return 'pending';
  }
}

const EVOLUTION_ACK: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  ERROR: 'failed',
};

/** Envoltorios de Baileys que traen el mensaje real adentro ({ message: {...} }). */
const BAILEYS_WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'deviceSentMessage', 'lottieStickerMessage'];

/** Saca los envoltorios (mensajes temporales, "ver una vez", documento con texto). */
function unwrapBaileys(message: Json): { message: Json; viewOnce: boolean } {
  let m = message;
  let viewOnce = false;
  for (let depth = 0; depth < 4; depth++) {
    const key = BAILEYS_WRAPPERS.find((k) => m[k] && typeof m[k] === 'object');
    if (!key) break;
    if (key.startsWith('viewOnce')) viewOnce = true;
    const inner = ((m[key] as Json).message ?? null) as Json | null;
    if (!inner || typeof inner !== 'object') break;
    m = inner;
  }
  return { message: m, viewOnce };
}

const BAILEYS_MEDIA = ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];

/**
 * Nombre de perfil que sirve para mostrar. Evolution guarda "Você" en lo que
 * manda el número y, en el historial sin nombre, los dígitos del teléfono o
 * del lid: nada de eso es un nombre.
 */
export function cleanPushName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!s || /^(você|voce|you|tú|tu)$/i.test(s)) return '';
  if (/^\+?[\d\s().-]{5,}$/.test(s)) return '';
  return s.slice(0, 120);
}

interface BaileysContent {
  body: string;
  media?: { url: string; type: string; name: string; size: number; info: MediaInfo };
  location?: LocationInfo;
  contacts?: ContactCard[];
  replyTo?: string;
  reaction?: Json;
  /** protocolMessage: edición (texto nuevo) o borrado para todos del mensaje `target`. */
  protocol?: { kind: 'edit' | 'revoke'; target: string; body: string };
  poll?: { question: string; options: string[]; multi: boolean };
  forwarded?: boolean;
  link?: LinkPreview;
  /** Ids mencionados (dígitos de teléfono o lid). */
  mentions?: string[];
}

/**
 * Vista previa de link de un extendedTextMessage (title, description,
 * matchedText o canonicalUrl, jpegThumbnail en base64). Solo http(s); la
 * miniatura, si es chica.
 */
export function linkPreviewOf(ext: Json): LinkPreview | undefined {
  const title = typeof ext.title === 'string' ? ext.title.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const raw = String(ext.matchedText ?? ext.canonicalUrl ?? '').trim();
  const url = /^https?:\/\/\S+$/i.test(raw) ? raw.slice(0, 1000) : '';
  if (!title || !url) return undefined;
  const description = typeof ext.description === 'string' ? ext.description.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  const thumb = typeof ext.jpegThumbnail === 'string' && /^[A-Za-z0-9+/=]+$/.test(ext.jpegThumbnail) && ext.jpegThumbnail.length < 24_000 ? `data:image/jpeg;base64,${ext.jpegThumbnail}` : '';
  return { url, title, ...(description ? { description } : {}), ...(thumb ? { thumbnail: thumb } : {}) };
}

/**
 * Texto y media de un `message` de Baileys (lo que manda o guarda Evolution).
 * `topContext`: el contextInfo que Evolution guarda afuera (y en el que
 * convierte extendedTextMessage en conversation).
 */
export function baileysContent(raw: Json, topContext?: unknown): BaileysContent {
  const { message, viewOnce } = unwrapBaileys(raw);
  const proto = (message.protocolMessage ?? ((((message.editedMessage ?? {}) as Json).message ?? {}) as Json).protocolMessage) as Json | undefined;
  if (proto) {
    const target = String(((proto.key ?? {}) as Json).id ?? '');
    const type = String(proto.type ?? '').toUpperCase();
    if (target && (type === 'REVOKE' || type === '0')) return { body: '', protocol: { kind: 'revoke', target, body: '' } };
    if (target && (type === 'MESSAGE_EDIT' || type === '14')) {
      const edited = unwrapBaileys((proto.editedMessage ?? {}) as Json).message;
      const text = typeof edited.conversation === 'string' ? edited.conversation : String(((edited.extendedTextMessage ?? {}) as Json).text ?? '');
      return { body: text, protocol: { kind: 'edit', target, body: text } };
    }
    return { body: '' };
  }
  if (message.reactionMessage) return { body: '', reaction: message.reactionMessage as Json };
  // Evolution guarda el contextInfo aparte (y convierte extendedTextMessage en conversation).
  const withCtx = (out: BaileysContent, inner?: unknown): BaileysContent => {
    const ctx = ((inner && typeof inner === 'object' ? inner : topContext) ?? {}) as Json;
    const top = (topContext ?? {}) as Json;
    const stanza = ctx.stanzaId ?? top.stanzaId;
    if (stanza) out.replyTo = String(stanza);
    if (ctx.isForwarded === true || top.isForwarded === true) out.forwarded = true;
    const mentions = mentionIds(ctx.mentionedJid ?? top.mentionedJid);
    if (mentions.length) out.mentions = mentions;
    return out;
  };
  if (typeof message.conversation === 'string') return withCtx({ body: message.conversation });
  const ext = message.extendedTextMessage as Json | undefined;
  if (ext) {
    const link = linkPreviewOf(ext);
    return withCtx({ body: String(ext.text ?? ''), ...(link ? { link } : {}) }, ext.contextInfo);
  }
  const pollMsg = (message.pollCreationMessage ?? message.pollCreationMessageV2 ?? message.pollCreationMessageV3) as Json | undefined;
  if (pollMsg) {
    const options = (Array.isArray(pollMsg.options) ? (pollMsg.options as Json[]) : []).map((o) => String(o.optionName ?? '')).filter(Boolean);
    const question = String(pollMsg.name ?? '');
    return withCtx({ body: question, poll: { question, options, multi: Number(pollMsg.selectableOptionsCount ?? 1) !== 1 } }, pollMsg.contextInfo);
  }
  const replyOf = (m: Json) => withCtx({ body: '' }, m.contextInfo).replyTo;
  for (const key of BAILEYS_MEDIA) {
    const m = message[key] as Json | undefined;
    if (m && typeof m === 'object') {
      const info = infoFromBaileys(key, m, viewOnce);
      const fallbackType = info.kind === 'voice' ? 'audio/ogg' : info.kind === 'sticker' ? 'image/webp' : key === 'documentMessage' ? 'application/octet-stream' : key.replace('Message', '');
      const name = String(m.fileName ?? (key === 'documentMessage' ? (m.title ?? '') : ''));
      return withCtx(
        {
          body: String(m.caption ?? ''),
          // La URL de WhatsApp está cifrada: el archivo se baja después por el gateway (fetchMedia).
          media: { url: '', type: String(m.mimetype ?? '') || fallbackType, name: name.slice(0, 200), size: byteLength(m.fileLength), info },
        },
        m.contextInfo,
      );
    }
  }
  for (const key of ['locationMessage', 'liveLocationMessage']) {
    const m = message[key] as Json | undefined;
    if (m && typeof m === 'object') {
      const location = locationFrom(m, key === 'liveLocationMessage');
      if (location) return { body: String(m.comment ?? ''), location, replyTo: replyOf(m) };
    }
  }
  const contact = message.contactMessage as Json | undefined;
  if (contact && typeof contact === 'object') {
    return { body: '', contacts: [parseVcard(String(contact.vcard ?? ''), String(contact.displayName ?? ''))], replyTo: replyOf(contact) };
  }
  const many = message.contactsArrayMessage as Json | undefined;
  if (many && typeof many === 'object') {
    const list = Array.isArray(many.contacts) ? (many.contacts as Json[]) : [];
    const contacts = list.slice(0, 20).map((c) => parseVcard(String(c.vcard ?? ''), String(c.displayName ?? '')));
    return { body: '', contacts, replyTo: replyOf(many) };
  }
  // "Ver una vez" sin contenido (WhatsApp no lo entrega a dispositivos vinculados): queda el aviso.
  if (viewOnce) return { body: '', media: { url: '', type: 'image', name: '', size: 0, info: { kind: 'image', viewOnce: true } } };
  return { body: '' };
}

/**
 * Media de un mensaje recibido. "evo:<id>": se baja después y se guarda en
 * nuestro storage (ver storeInboundMedia), también la que se mandó desde el
 * teléfono (fromMe). Más grande que el tope o "ver una vez": queda el tipo, el
 * nombre y los datos, sin bajarlo.
 */
function inboundEvolutionMedia(
  media: { type: string; name: string; size: number; info: MediaInfo },
  id: string,
  remoteJid: string,
  fromMe: boolean,
): NonNullable<Extract<InboundEvent, { type: 'message' }>['media']> {
  // Un sticker Lottie (application/was) no se puede dibujar en el navegador: queda el lugar del sticker, sin bajarlo.
  const fetchable = media.size <= MAX_INBOUND_MEDIA && !media.info.viewOnce && !media.info.lottie;
  return {
    url: fetchable ? `evo:${id}` : '',
    type: media.type,
    name: media.name,
    info: media.info,
    ...(fetchable ? { fetchRef: { providerMessageId: id, chatId: remoteJid, fromMe } } : {}),
  };
}

/** Estado de entrega de un mensaje guardado por Evolution (status o el último MessageUpdate). */
function storedStatus(m: Json): 'sent' | 'delivered' | 'read' | undefined {
  const rank = { sent: 1, delivered: 2, read: 3 } as const;
  let best: 'sent' | 'delivered' | 'read' | undefined;
  const consider = (raw: unknown) => {
    const st = EVOLUTION_ACK[String(raw ?? '').toUpperCase()];
    if (st && st !== 'failed' && (!best || rank[st] > rank[best])) best = st;
  };
  consider(m.status);
  for (const u of Array.isArray(m.MessageUpdate) ? (m.MessageUpdate as Json[]) : []) consider(u.status);
  return best;
}

/**
 * Un mensaje de Evolution (webhook messages.upsert / messages.set, o un
 * registro de findMessages) → eventos. `history`: viene del historial.
 */
export function evolutionMessageEvents(m: Json, history = false): InboundEvent[] {
  const key = (m.key ?? {}) as Json;
  // Chats con id "@lid": se usa el id con teléfono cuando Evolution lo da.
  const chatId = pnJid(String(key.remoteJid ?? ''), key.remoteJidAlt, key.senderPn, m.senderPn);
  const id = String(key.id ?? '');
  if (!chatId || !id || chatId === 'status@broadcast' || /@(broadcast|newsletter)$/.test(chatId)) return [];
  const isGroup = isGroupJid(chatId);
  const fromMe = key.fromMe === true;
  const participant = pnJid(String(key.participant ?? m.participant ?? ''), key.participantAlt, key.participantPn, m.participantPn);
  const pushName = fromMe ? '' : cleanPushName(m.pushName);
  // El lid de quien manda (y del chat 1:1), cuando WhatsApp lo da: con él se nombran las menciones "@<lid>".
  const senderLid = fromMe
    ? ''
    : isGroup
      ? firstLid(key.participant, m.participant, key.participantAlt, key.participantLid, m.participantLid)
      : firstLid(key.remoteJid, key.remoteJidAlt, key.senderLid, m.senderLid);
  const chatLid = isGroup ? '' : firstLid(key.remoteJid, key.remoteJidAlt, key.senderLid, m.senderLid);
  const pollUpdate = ((m.message ?? {}) as Json).pollUpdateMessage as Json | undefined;
  if (pollUpdate) {
    // Evolution manda el voto descifrado en vote.selectedOptions (si el gateway lo descifra).
    const target = String(((pollUpdate.pollCreationMessageKey ?? {}) as Json).id ?? '');
    const vote = (pollUpdate.vote ?? m.pollVote ?? {}) as Json;
    const selected = Array.isArray(vote.selectedOptions) ? (vote.selectedOptions as Array<string | number>) : null;
    if (target && selected && !fromMe) {
      return [{ type: 'poll_vote', chatId, pollProviderMessageId: target, voterPhone: phoneDigits(isGroup ? participant : chatId), voterName: pushName, options: selected }];
    }
    return [];
  }
  const content = baileysContent((m.message ?? {}) as Json, m.contextInfo);
  const sender = isGroup ? participant : fromMe ? '' : chatId;
  // Cuándo pasó (segundos): las ediciones y reacciones lo llevan para no pisar una más nueva con una vieja.
  const evTs = Number(m.messageTimestamp);
  const at = Number.isFinite(evTs) && evTs > 0 ? { at: new Date((evTs > 1e12 ? evTs : evTs * 1000)).toISOString() } : {};
  if (content.protocol) {
    return [
      content.protocol.kind === 'edit'
        ? { type: 'edit', chatId, providerMessageId: content.protocol.target, body: content.protocol.body, ...at }
        : { type: 'revoke', chatId, providerMessageId: content.protocol.target },
    ];
  }
  if (content.reaction) {
    const target = ((content.reaction.key ?? {}) as Json).id;
    if (!target) return [];
    return [
      {
        type: 'reaction',
        chatId,
        targetProviderMessageId: String(target),
        emoji: String(content.reaction.text ?? ''),
        senderPhone: phoneDigits(sender),
        senderName: pushName,
        fromMe,
        ...at,
      },
    ];
  }
  // Mensajes de sistema sin contenido (cambios de clave, avisos de cifrado): no son parte de la conversación.
  if (!content.body && !content.media && !content.poll && !content.location && !content.contacts?.length) return [];
  const ts = Number(m.messageTimestamp);
  const out: InboundEvent = {
    type: 'message',
    chatId,
    isGroup,
    fromMe,
    senderPhone: phoneDigits(sender),
    senderName: pushName,
    providerMessageId: id,
    body: content.body,
    media: content.media ? inboundEvolutionMedia(content.media, id, String(key.remoteJid ?? chatId), fromMe) : undefined,
    ...(content.location ? { location: content.location } : {}),
    ...(content.contacts?.length ? { contacts: content.contacts } : {}),
    replyToProviderId: content.replyTo,
    timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : undefined,
    ...(history ? { history: true } : {}),
    ...(fromMe ? { status: storedStatus(m) } : {}),
    ...(content.poll ? { poll: content.poll } : {}),
    ...(content.forwarded ? { forwarded: true } : {}),
    ...(content.link ? { link: content.link } : {}),
    ...(content.mentions?.length ? { mentions: content.mentions } : {}),
    ...(senderLid ? { senderLid } : {}),
    ...(chatLid ? { chatLid } : {}),
  };
  return [out];
}

/**
 * Contactos de Evolution (contacts.upsert / findContacts) → nombre y foto por
 * chat. Con Baileys 7 un contacto puede venir por su lid con el teléfono
 * aparte (phoneNumber) o al revés (lid): esa equivalencia también viaja.
 */
export function evolutionContactEvents(rows: Json[]): InboundEvent[] {
  const out: InboundEvent[] = [];
  for (const c of rows) {
    const jid = String(c.remoteJid ?? c.id ?? '');
    if (!jid || !/@(s\.whatsapp\.net|g\.us|lid)$/.test(jid)) continue;
    const name = cleanPushName(c.pushName ?? c.name ?? c.notify ?? c.verifiedName);
    // El nombre de la libreta del teléfono, cuando el servidor lo manda aparte del de perfil.
    const saved = typeof c.pushName === 'string' && c.name !== c.pushName ? cleanPushName(c.name) : '';
    const pictureUrl = typeof c.profilePicUrl === 'string' && /^https:\/\//.test(c.profilePicUrl) ? c.profilePicUrl : '';
    const group = isGroupJid(jid);
    const lid = group ? '' : firstLid(jid, c.lid, c.remoteJidAlt, c.jid);
    let phone = group ? '' : phoneDigits(jid);
    if (!group && !phone) {
      for (const alt of [c.phoneNumber, c.jid, c.remoteJidAlt, c.senderPn]) {
        const d = typeof alt === 'string' && !isLidJid(alt) ? phoneDigits(alt) : '';
        if (d.length >= 8 && d.length <= 15) {
          phone = d;
          break;
        }
      }
    }
    const mapping = !!lid && !!phone;
    if (!name && !pictureUrl && !mapping) continue;
    out.push({
      type: 'contact',
      chatId: jid,
      ...(name ? { name } : {}),
      ...(pictureUrl ? { pictureUrl } : {}),
      ...(saved && saved !== name ? { saved } : {}),
      ...(lid ? { lid } : {}),
      ...(lid && phone ? { phone } : {}),
    });
  }
  return out;
}

const PRESENCE_STATES = new Set(['composing', 'recording', 'available', 'unavailable', 'paused']);

/**
 * PRESENCE_UPDATE de Evolution (Baileys): { id, presences: { [jid]: { lastKnownPresence } } }.
 * En un grupo, cada participante trae la suya: gana quien escribe o graba.
 */
export function evolutionPresence(d: Json): InboundEvent[] {
  const chatId = String(d.id ?? '');
  if (!/@(s\.whatsapp\.net|g\.us|lid)$/.test(chatId)) return [];
  const presences = (d.presences && typeof d.presences === 'object' ? d.presences : {}) as Record<string, Json>;
  let best: { who: string; state: string } | null = null;
  for (const [jid, p] of Object.entries(presences)) {
    const state = String((p ?? {}).lastKnownPresence ?? '');
    if (!PRESENCE_STATES.has(state)) continue;
    const who = /@lid$/.test(jid) ? '' : phoneDigits(jid);
    if (!best || ((state === 'composing' || state === 'recording') && best.state !== 'composing' && best.state !== 'recording')) best = { who, state };
  }
  if (!best) return [];
  return [{ type: 'presence', chatId, who: isGroupJid(chatId) ? best.who : '', state: best.state as 'composing' }];
}

/**
 * Cuerpo de /chat/archiveChat (Evolution v2). Evolution pasa `lastMessage`
 * tal cual a Baileys (chatModify), que arma la acción de app-state que
 * sincroniza el teléfono:
 * - `key` completa: id y remoteJid no vacíos (si no, Evolution responde 400 o
 *   Baileys "Incomplete key"); en un grupo, un mensaje ajeno lleva
 *   `participant`;
 * - `messageTimestamp` en segundos: si falta, Evolution pone Date.now() (en
 *   milisegundos) y la acción sale con una hora inválida;
 * - el chat sale de `key.remoteJid`, así que va el id del chat.
 * Sin un mensaje de referencia usable se manda solo { chat, archive } (Evolution
 * lo busca en su base).
 */
export function evolutionArchiveBody(chatId: string, archive: boolean, last?: ArchiveRef): Record<string, unknown> {
  const body: Record<string, unknown> = { chat: chatId, archive };
  if (!last?.id || !chatId) return body;
  const raw = Number(last.timestamp);
  // Hora en segundos aunque venga en milisegundos.
  const ts = Number.isFinite(raw) && raw > 0 ? Math.floor(raw > 1e12 ? raw / 1000 : raw) : 0;
  if (!ts) return body;
  const group = isGroupJid(chatId);
  if (group && !last.fromMe && !last.participant) return body;
  const key: Record<string, unknown> = { remoteJid: chatId, fromMe: !!last.fromMe, id: last.id };
  if (group && !last.fromMe && last.participant) key.participant = last.participant;
  body.lastMessage = { key, messageTimestamp: ts };
  return body;
}

/** Webhook de Evolution API → eventos normalizados. */
export function parseEvolutionWebhook(body: unknown): InboundEvent[] {
  const b = (body ?? {}) as Json;
  const event = String(b.event ?? '').toLowerCase().replace(/_/g, '.');
  const d = (b.data ?? {}) as Json;
  switch (event) {
    case 'messages.upsert':
    case 'messages.set': {
      // messages.set: el historial que WhatsApp manda al vincular (se guarda sin avisos).
      const history = event === 'messages.set';
      const rows = Array.isArray(d) ? (d as Json[]) : Array.isArray(d.messages) ? (d.messages as Json[]) : [d];
      return rows.flatMap((m) => evolutionMessageEvents(m, history));
    }
    case 'contacts.upsert':
    case 'contacts.update':
    case 'contacts.set':
      return evolutionContactEvents(Array.isArray(d) ? (d as Json[]) : [d]);
    case 'chats.update': {
      // Archivar o desarchivar desde el teléfono: la fila trae `archived` (o `archive`).
      const rows = Array.isArray(d) ? (d as Json[]) : [d];
      return rows.flatMap((c): InboundEvent[] => {
        const jid = String(c.remoteJid ?? c.id ?? '');
        const flag = typeof c.archived === 'boolean' ? c.archived : typeof c.archive === 'boolean' ? c.archive : null;
        return jid && flag !== null && !/@(broadcast|newsletter)$/.test(jid) ? [{ type: 'archive', chatId: jid, archived: flag }] : [];
      });
    }
    case 'chats.set':
    case 'chats.upsert': {
      // Solo los grupos traen un nombre confiable acá (en los 1:1 Evolution pone el pushName del último mensaje, que puede ser el nuestro).
      const rows = Array.isArray(d) ? (d as Json[]) : [d];
      const names = rows
        .filter((c) => isGroupJid(String(c.remoteJid ?? c.id ?? '')) && cleanPushName(c.name))
        .map((c) => ({ type: 'contact' as const, chatId: String(c.remoteJid ?? c.id), name: cleanPushName(c.name) }));
      // CHATS_SET lo atiende ingestHistoryChats (con el resto de los datos del chat); CHATS_UPSERT trae el estado de archivado de a un chat.
      const flags: InboundEvent[] =
        event === 'chats.upsert'
          ? rows.flatMap((c): InboundEvent[] => {
              const jid = String(c.remoteJid ?? c.id ?? '');
              const flag = typeof c.archived === 'boolean' ? c.archived : typeof c.archive === 'boolean' ? c.archive : null;
              return jid && flag !== null && !/@(broadcast|newsletter)$/.test(jid) ? [{ type: 'archive', chatId: jid, archived: flag }] : [];
            })
          : [];
      return [...names, ...flags];
    }
    case 'messages.update': {
      const rows = Array.isArray(d) ? (d as Json[]) : [d];
      const out: InboundEvent[] = [];
      for (const u of rows) {
        const st = EVOLUTION_ACK[String(u.status ?? '').toUpperCase()];
        const id = String(u.keyId ?? ((u.key ?? {}) as Json).id ?? '');
        if (st && id) out.push({ type: 'status', providerMessageId: id, status: st });
        // Resultado agregado de una encuesta: [{ name, voters: [jid] }] → un voto por persona.
        const agg = Array.isArray(u.pollUpdates) ? (u.pollUpdates as Json[]) : null;
        if (agg && id) {
          const byVoter = new Map<string, string[]>();
          for (const opt of agg) {
            for (const v of Array.isArray(opt.voters) ? (opt.voters as unknown[]) : []) {
              const phone = phoneDigits(idString(v));
              if (!phone) continue;
              byVoter.set(phone, [...(byVoter.get(phone) ?? []), String(opt.name ?? '')]);
            }
          }
          const uk = (u.key ?? {}) as Json;
          const chatId = pnJid(String(u.remoteJid ?? uk.remoteJid ?? ''), uk.remoteJidAlt, u.remoteJidAlt);
          for (const [phone, options] of byVoter) {
            out.push({ type: 'poll_vote', chatId, pollProviderMessageId: id, voterPhone: phone, voterName: '', options });
          }
        }
      }
      return out;
    }
    case 'messages.delete': {
      const key = ((d.key ?? d) as Json) ?? {};
      const id = String(key.id ?? '');
      const chatId = pnJid(String(key.remoteJid ?? ''), key.remoteJidAlt);
      return id && chatId ? [{ type: 'revoke', chatId, providerMessageId: id }] : [];
    }
    case 'call': {
      const rows = Array.isArray(d) ? (d as Json[]) : [d];
      const out: InboundEvent[] = [];
      for (const c of rows) {
        const status = EVOLUTION_CALL[String(c.status ?? '').toLowerCase()];
        const chatId = String(c.chatId ?? c.from ?? '');
        if (!status || !c.id || !chatId || c.isGroup === true || isGroupJid(chatId)) continue;
        const at = c.date ? Date.parse(String(c.date)) : NaN;
        out.push({
          type: 'call',
          chatId,
          callId: String(c.id),
          direction: 'in',
          status,
          senderPhone: phoneDigits(String(c.from ?? chatId)),
          isVideo: c.isVideo === true,
          timestamp: Number.isFinite(at) ? new Date(at).toISOString() : undefined,
        });
      }
      return out;
    }
    case 'presence.update':
      return evolutionPresence(d);
    case 'connection.update':
      return [{ type: 'session', status: evolutionStatus(d.state), phone: d.wuid ? phoneDigits(String(d.wuid)) : undefined }];
    case 'qrcode.updated': {
      const qr = ((d.qrcode ?? {}) as Json).base64;
      return [{ type: 'session', status: 'qr', qr: qr ? String(qr) : undefined }];
    }
    case 'group.participants.update':
    case 'group-participants.update': {
      const action = String(d.action ?? '') as ParticipantAction;
      if (!['add', 'remove', 'promote', 'demote'].includes(action) || !d.id) return [];
      const parts = Array.isArray(d.participants) ? (d.participants as unknown[]) : [];
      const phones = parts.map(participantPhone).filter(Boolean);
      return phones.length ? [{ type: 'participants', chatId: String(d.id), action, phones }] : [];
    }
    default:
      return [];
  }
}

/**
 * Un archivo recibido por Evolution: getBase64FromMediaMessage con solo la
 * key del mensaje (el gateway lo busca en su base y lo descifra). Nada del
 * mensaje que llegó por el webhook se reenvía. La respuesta se lee con tope
 * (base64 del máximo más un margen) y se vuelve a medir al decodificar.
 */
async function evolutionMedia(
  api: (path: string, method?: string, body?: unknown, o?: { maxBytes?: number }) => Promise<unknown>,
  instance: string,
  ref: MediaRef,
  maxBytes: number,
): Promise<FetchedMedia> {
  const message = { key: { id: ref.providerMessageId, remoteJid: ref.chatId, fromMe: ref.fromMe } };
  const r = (await api(
    `/chat/getBase64FromMediaMessage/${instance}`,
    'POST',
    { message, convertToMp4: false },
    { maxBytes: Math.ceil((maxBytes * 4) / 3) + 64 * 1024 },
  )) as Json;
  const b64 = typeof r.base64 === 'string' ? r.base64.replace(/^data:[^,]*,/, '') : '';
  if (!b64) throw new ProviderError('not_found');
  if (Math.floor((b64.length * 3) / 4) > maxBytes) throw new ProviderError('provider_error', 413);
  const data = Buffer.from(b64, 'base64');
  if (data.length === 0 || data.length > maxBytes) throw new ProviderError('provider_error', 413);
  return { data, mimetype: String(r.mimetype ?? 'application/octet-stream'), filename: String(r.fileName ?? '') };
}

export function evolutionProvider(cfg: BridgeConfig, opts: { fetch?: FetchLike } = {}): GroupsProvider & { start(): Promise<ConnectState> } {
  const f = opts.fetch ?? defaultBridgeFetch;
  const fMedia = opts.fetch ?? mediaBridgeFetch;
  const instance = encodeURIComponent(cfg.session || 'zerosoft');
  const headers = { apikey: cfg.apiKey ?? '' };
  const api = (path: string, method = 'GET', body?: unknown, o?: { maxBytes?: number }) =>
    bridgeRequest(f, `${baseOf(cfg)}${path}`, headers, method, body, o);
  const mediaApi = (path: string, body: unknown) => bridgeRequest(fMedia, `${baseOf(cfg)}${path}`, headers, 'POST', body);
  const q = (groupId: string) => `?groupJid=${encodeURIComponent(groupId)}`;

  async function qr(): Promise<string | undefined> {
    const r = (await api(`/instance/connect/${instance}`).catch(() => null)) as Json | null;
    const b64 = r?.base64 ? String(r.base64) : '';
    return b64 ? (b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`) : undefined;
  }

  async function state(): Promise<ConnectState> {
    const r = (await api(`/instance/connectionState/${instance}`)) as Json;
    const status = evolutionStatus(((r.instance ?? r) as Json).state);
    const out: ConnectState = { status };
    if (status === 'qr') out.qr = await qr();
    if (status === 'connected') {
      const list = (await api(`/instance/fetchInstances?instanceName=${instance}`).catch(() => [])) as Json[];
      const row = Array.isArray(list) ? list[0] : undefined;
      const owner = row?.ownerJid ?? ((row?.instance ?? {}) as Json).owner;
      if (owner) out.phone = phoneDigits(String(owner));
    }
    return out;
  }

  /**
   * Estado al conectar. Una sesión cerrada (se desvinculó desde el teléfono, o venció el QR) no
   * vuelve a pedir QR sola: hay que arrancarla con /instance/connect, que además lo devuelve.
   */
  async function start(): Promise<ConnectState> {
    const s = await state();
    if (s.status !== 'disconnected') return s;
    const code = await qr();
    return code ? { status: 'qr', qr: code } : state();
  }

  const history: HistorySource = {
    async chats(page, size) {
      const rows = (await api(`/chat/findChats/${instance}`, 'POST', { take: size, skip: page * size }, { maxBytes: 8 * 1024 * 1024 })) as unknown;
      return (Array.isArray(rows) ? (rows as Json[]) : []).flatMap((c): HistoryChat[] => {
        const remoteJid = String(c.remoteJid ?? '');
        if (!remoteJid || /@(broadcast|newsletter)$/.test(remoteJid)) return [];
        const last = (c.lastMessage ?? {}) as Json;
        const lk = (last.key ?? {}) as Json;
        const chatId = pnJid(remoteJid, lk.remoteJidAlt, lk.senderPn);
        const isGroup = isGroupJid(chatId);
        // En un 1:1, el nombre del contacto; si no hay, el pushName del último mensaje que mandó la otra persona.
        const name = cleanPushName(c.pushName) || (!isGroup && lk.fromMe !== true ? cleanPushName(last.pushName) : '');
        const ts = Number(last.messageTimestamp);
        const pic = typeof c.profilePicUrl === 'string' && /^https:\/\//.test(c.profilePicUrl) ? c.profilePicUrl : '';
        return [{ remoteJid, chatId, isGroup, name, pictureUrl: pic, unread: Math.max(0, Number(c.unreadCount) || 0), archived: c.archived === true || c.archive === true, lastAt: Number.isFinite(ts) ? ts : 0 }];
      });
    },
    async messagePage(remoteJid, size, page) {
      const r = (await api(
        `/chat/findMessages/${instance}`,
        'POST',
        { where: { key: { remoteJid } }, offset: Math.max(1, Math.min(size, 500)), page: Math.max(1, Math.floor(page)) },
        { maxBytes: 16 * 1024 * 1024 },
      )) as Json;
      const box = (r.messages ?? {}) as Json;
      const list = Array.isArray(box.records) ? (box.records as Json[]) : [];
      const pages = Number(box.pages);
      const current = Number(box.currentPage) || Math.floor(page);
      const events = list
        .slice()
        .sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0))
        .flatMap((m) => evolutionMessageEvents(m, true));
      // Sin "pages" (otra versión), hay más mientras la página venga llena.
      const more = Number.isFinite(pages) && pages > 0 ? current < pages : list.length >= size;
      return { events, more, total: Number(box.total) || 0 };
    },
    async messages(remoteJid, limit, page = 1) {
      const r = (await api(
        `/chat/findMessages/${instance}`,
        'POST',
        { where: { key: { remoteJid } }, offset: Math.max(1, Math.min(limit, 500)), page: Math.max(1, Math.floor(page)) },
        { maxBytes: 16 * 1024 * 1024 },
      )) as Json;
      const records = ((r.messages ?? {}) as Json).records;
      const list = Array.isArray(records) ? (records as Json[]) : [];
      // Vienen del más nuevo al más viejo: se devuelven en orden (las respuestas encuentran su cita).
      return list
        .slice()
        .sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0))
        .flatMap((m) => evolutionMessageEvents(m, true));
    },
    async contacts(page, size) {
      const rows = (await api(`/chat/findContacts/${instance}`, 'POST', { offset: size, page: page + 1 }, { maxBytes: 8 * 1024 * 1024 })) as unknown;
      return evolutionContactEvents(Array.isArray(rows) ? (rows as Json[]) : []).flatMap((e): HistoryContact[] =>
        e.type === 'contact'
          ? [{ chatId: e.chatId, name: e.name ?? '', pictureUrl: e.pictureUrl ?? '', ...(e.saved ? { saved: e.saved } : {}), ...(e.lid ? { lid: e.lid } : {}), ...(e.phone ? { phone: e.phone } : {}) }]
          : [],
      );
    },
    async picture(chatId) {
      const r = (await api(`/chat/fetchProfilePictureUrl/${instance}`, 'POST', { number: chatId }).catch(() => null)) as Json | null;
      const url = r ? String(r.profilePictureUrl ?? '') : '';
      return /^https?:\/\//.test(url) ? url : '';
    },
  };

  async function update(groupId: string, action: ParticipantAction, phones: string[]): Promise<ParticipantResult[]> {
    const r = (await api(`/group/updateParticipant/${instance}${q(groupId)}`, 'POST', {
      action,
      participants: phones.map(phoneDigits),
    })) as Json;
    // Evolution devuelve el resultado por participante cuando WhatsApp lo rechaza (privacidad, no existe).
    const rows = Array.isArray(r.updateParticipants) ? (r.updateParticipants as Json[]) : [];
    return phones.map((phone) => {
      const hit = rows.find((x) => phoneDigits(idString(x.jid ?? x.id)) === phoneDigits(phone));
      const status = String(hit?.status ?? '200');
      return status === '200' ? { phone, ok: true } : { phone, ok: false, error: `whatsapp_${status}` };
    });
  }

  return {
    kind: 'evolution',
    caps: PROVIDER_CAPS.evolution,
    history,
    async connect(webhookUrl) {
      const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVOLUTION_EVENTS };
      try {
        await api('/instance/create', 'POST', {
          instanceName: cfg.session || 'zerosoft',
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          // WhatsApp manda el historial solo al vincular y solo si la instancia lo pide.
          syncFullHistory: true,
          webhook,
        });
      } catch (err) {
        if (!(err instanceof ProviderError) || ![400, 403, 409].includes(err.httpStatus ?? 0)) throw err;
        await api(`/webhook/set/${instance}`, 'POST', { webhook });
      }
      return start();
    },
    state,
    start,
    /**
     * Grupo: /group/findGroupInfos (rápido, uno por vez; fetchAllGroups tarda
     * minutos con muchos grupos). Persona: /chat/fetchProfile (nombre, "info" y foto).
     */
    async chatInfo(chatId): Promise<ChatInfo | null> {
      const https = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v.slice(0, 2000) : '');
      if (isGroupJid(chatId)) {
        const r = (await api(`/group/findGroupInfos/${instance}${q(chatId)}`)) as Json;
        if (!r || typeof r !== 'object' || !r.id) return null;
        const parts = Array.isArray(r.participants) ? (r.participants as Json[]) : [];
        const size = Number(r.size);
        const creation = Number(r.creation);
        return {
          name: typeof r.subject === 'string' ? r.subject.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          about: typeof r.desc === 'string' ? r.desc.slice(0, 2000) : '',
          pictureUrl: https(r.pictureUrl),
          participants: parts
            .slice(0, 2000)
            .map((p) => {
              const lid = participantLid(p);
              const name = cleanPushName(p.name ?? p.notify ?? p.pushName);
              return { phone: participantPhone(p), role: roleOf(p.admin), ...(lid ? { lid } : {}), ...(name ? { name } : {}) };
            })
            .filter((p) => p.phone),
          // Los que solo traen lid: no se listan como teléfono, pero nombran las menciones "@<lid>".
          lidParticipants: parts
            .slice(0, 2000)
            .filter((p) => !participantPhone(p))
            .flatMap((p) => {
              const lid = participantLid(p);
              const name = cleanPushName(p.name ?? p.notify ?? p.pushName);
              return lid ? [{ lid, ...(name ? { name } : {}) }] : [];
            }),
          size: Number.isFinite(size) && size > 0 ? size : parts.length,
          ...(Number.isFinite(creation) && creation > 0 ? { createdAt: creation } : {}),
        };
      }
      const r = (await api(`/chat/fetchProfile/${instance}`, 'POST', { number: chatId })) as Json;
      if (!r || typeof r !== 'object') return null;
      const st = r.status;
      const about = typeof st === 'string' ? st : st && typeof st === 'object' ? String((st as Json).status ?? '') : '';
      // El perfil solo trae nombre en cuentas de empresa: si no, el que el contacto puso en WhatsApp (findContacts).
      let name = cleanPushName(r.name);
      if (!name) {
        const rows = (await api(`/chat/findContacts/${instance}`, 'POST', { where: { remoteJid: chatId } }).catch(() => [])) as unknown;
        const first = Array.isArray(rows) ? ((rows as Json[]).find((c) => c.remoteJid === chatId) ?? null) : null;
        name = cleanPushName(first?.pushName);
      }
      // La foto: la del perfil; si no viene (pasa seguido, sobre todo con chats por lid), se pide aparte.
      let pictureUrl = https(r.picture);
      if (!pictureUrl) {
        const pic = (await api(`/chat/fetchProfilePictureUrl/${instance}`, 'POST', { number: chatId }).catch(() => null)) as Json | null;
        pictureUrl = https(pic?.profilePictureUrl);
      }
      return { name, about: about.trim().slice(0, 1000), pictureUrl, isBusiness: r.isBusiness === true };
    },
    async disconnect() {
      await api(`/instance/logout/${instance}`, 'DELETE').catch(() => null);
    },
    /**
     * /chat/sendPresence: Evolution se suscribe a la presencia del chat (llegan
     * "escribiendo" y "en línea" por PRESENCE_UPDATE), manda la nuestra y la
     * deja en pausa después de `ms` (el pedido tarda eso).
     */
    async sendPresence(chatId, state, ms) {
      await api(`/chat/sendPresence/${instance}`, 'POST', { number: chatId, presence: state, delay: Math.max(0, Math.min(ms, 10_000)) });
    },
    /** /chat/whatsappNumbers (Evolution v2): si el teléfono tiene WhatsApp y con qué id. No manda nada al contacto. */
    async checkNumber(phone) {
      const rows = (await api(`/chat/whatsappNumbers/${instance}`, 'POST', { numbers: [phoneDigits(phone)] })) as unknown;
      const first = Array.isArray(rows) ? ((rows[0] ?? null) as Json | null) : null;
      if (!first || typeof first.exists !== 'boolean') return null;
      const jid = typeof first.jid === 'string' && /^\d{8,15}@s\.whatsapp\.net$/.test(first.jid) ? first.jid : undefined;
      return { exists: first.exists, ...(jid ? { jid } : {}) };
    },
    /** /chat/updateBlockStatus (Evolution v2): bloquea o desbloquea el número en WhatsApp. */
    async blockContact(chatId, block) {
      await api(`/chat/updateBlockStatus/${instance}`, 'POST', { number: chatId, status: block ? 'block' : 'unblock' });
    },
    /** /chat/archiveChat (Evolution v2): el cuerpo lo arma evolutionArchiveBody. */
    async archiveChat(chatId, archive, last) {
      await api(`/chat/archiveChat/${instance}`, 'POST', evolutionArchiveBody(chatId, archive, last));
    },
    async sendText(chatId, text, o) {
      const r = (await api(`/message/sendText/${instance}`, 'POST', {
        number: chatId,
        text,
        ...(o?.replyTo ? { quoted: { key: { id: o.replyTo } } } : {}),
        ...(o?.mentions?.length ? { mentioned: o.mentions.slice(0, 50) } : {}),
      })) as Json;
      return { id: String(((r.key ?? {}) as Json).id ?? '') };
    },
    /**
     * Media según el tipo (lib/groups-media.ts), contra Evolution v2.3:
     * - nota de voz: /message/sendWhatsAppAudio con encoding (Evolution la
     *   convierte a OGG/Opus con ffmpeg: sirve el webm del navegador);
     * - sticker: /message/sendSticker (Evolution la pasa a WebP);
     * - imagen, video, audio y documento: /message/sendMedia. Evolution saca el
     *   mimetype del nombre del archivo, así que el nombre lleva la extensión.
     * El archivo va como URL pública o, si no hay, en base64.
     */
    async sendMedia(chatId, media) {
      const kind = media.kind ?? planOutboundKind(media.mimetype, undefined, null);
      const source = media.base64 ?? media.url;
      const quoted = media.replyTo ? { quoted: { key: { id: media.replyTo } } } : {};
      let r: Json;
      if (kind === 'voice') {
        r = (await mediaApi(`/message/sendWhatsAppAudio/${instance}`, { number: chatId, audio: source, encoding: true, ...quoted })) as Json;
      } else if (kind === 'sticker') {
        r = (await mediaApi(`/message/sendSticker/${instance}`, { number: chatId, sticker: source, ...quoted })) as Json;
      } else {
        const fileName = evolutionFileName(media.filename, media.mimetype, kind);
        r = (await mediaApi(`/message/sendMedia/${instance}`, {
          number: chatId,
          mediatype: kind,
          mimetype: kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : media.mimetype.split(';')[0].trim(),
          media: source,
          fileName,
          // WhatsApp no muestra texto en un audio: lo manda aparte quien llama.
          ...(kind === 'audio' ? {} : { caption: media.caption ?? '' }),
          ...quoted,
        })) as Json;
      }
      const id = String(((r.key ?? {}) as Json).id ?? '');
      if (!id) throw new ProviderError('provider_error');
      return { id };
    },
    async react(chatId, messageId, emoji, fromMe) {
      await api(`/message/sendReaction/${instance}`, 'POST', { key: { remoteJid: chatId, fromMe, id: messageId }, reaction: emoji });
    },
    async sendPoll(chatId, poll) {
      const r = (await api(`/message/sendPoll/${instance}`, 'POST', {
        number: chatId,
        name: poll.question,
        selectableCount: poll.multi ? poll.options.length : 1,
        values: poll.options,
      })) as Json;
      return { id: String(((r.key ?? {}) as Json).id ?? '') };
    },
    /** /message/sendContact: una vCard por contacto (Evolution arma el waid con los dígitos). */
    async sendContact(chatId, contacts) {
      const r = (await api(`/message/sendContact/${instance}`, 'POST', {
        number: chatId,
        contact: contacts.slice(0, 10).map((c) => {
          const digits = phoneDigits(c.phone);
          return { fullName: c.name.slice(0, 100) || `+${digits}`, wuid: digits, phoneNumber: `+${digits}` };
        }),
      })) as Json;
      const id = String(((r.key ?? {}) as Json).id ?? '');
      if (!id) throw new ProviderError('provider_error');
      return { id };
    },
    async markRead(chatId, messageIds) {
      if (!messageIds.length) return;
      await api(`/chat/markMessageAsRead/${instance}`, 'POST', {
        readMessages: messageIds.slice(0, 50).map((id) => ({ remoteJid: chatId, fromMe: false, id })),
      });
    },
    sendTemplate: async () => {
      throw new ProviderError('unsupported');
    },
    listTemplates: async () => [],
    fetchMedia: (ref, maxBytes) => evolutionMedia(api, instance, ref, maxBytes),
    async listGroups(): Promise<GroupInfo[]> {
      const rows = (await api(`/group/fetchAllGroups/${instance}?getParticipants=false`)) as Json[];
      return (Array.isArray(rows) ? rows : [])
        .map((g) => ({ id: String(g.id ?? ''), name: String(g.subject ?? ''), description: String(g.desc ?? ''), ...flagsOf(g) }))
        .filter((g) => isGroupJid(g.id));
    },
    async createGroup(name, phones) {
      const r = (await api(`/group/create/${instance}`, 'POST', { subject: name, participants: phones.map(phoneDigits) })) as Json;
      const id = String(r.id ?? ((r.groupMetadata ?? {}) as Json).id ?? '');
      if (!id) throw new ProviderError('provider_error');
      return { id, name };
    },
    async participants(groupId) {
      const r = (await api(`/group/participants/${instance}${q(groupId)}`)) as Json;
      const rows = Array.isArray(r.participants) ? (r.participants as Json[]) : [];
      // Los que solo tienen un lid (sin teléfono a la vista) no se pueden listar como teléfono.
      return rows
        .map((p) => {
          const lid = participantLid(p);
          return { phone: participantPhone(p), role: roleOf(p.admin), name: typeof p.name === 'string' ? p.name : undefined, ...(lid ? { lid } : {}) };
        })
        .filter((p) => p.phone);
    },
    updateParticipants: update,
    async inviteLink(groupId, revoke) {
      if (revoke) await api(`/group/revokeInviteCode/${instance}${q(groupId)}`, 'POST');
      const r = (await api(`/group/inviteCode/${instance}${q(groupId)}`)) as Json;
      const url = String(r.inviteUrl ?? (r.inviteCode ? `https://chat.whatsapp.com/${String(r.inviteCode)}` : ''));
      if (!url) throw new ProviderError('provider_error');
      return url;
    },
    async updateGroup(groupId, patch) {
      if (patch.name !== undefined) await api(`/group/updateGroupSubject/${instance}${q(groupId)}`, 'POST', { subject: patch.name });
      if (patch.description !== undefined)
        await api(`/group/updateGroupDescription/${instance}${q(groupId)}`, 'POST', { description: patch.description });
    },
    async editMessage(chatId, messageId, text) {
      await api(`/chat/updateMessage/${instance}`, 'POST', { number: chatId, key: { remoteJid: chatId, fromMe: true, id: messageId }, text });
    },
    async deleteMessage(chatId, messageId) {
      await api(`/chat/deleteMessageForEveryone/${instance}`, 'DELETE', { id: messageId, remoteJid: chatId, fromMe: true });
    },
    pinMessage: async () => {
      throw new ProviderError('unsupported');
    },
    forwardMessage: async () => {
      throw new ProviderError('unsupported');
    },
    async updateGroupSettings(groupId, patch) {
      const path = `/group/updateSetting/${instance}${q(groupId)}`;
      if (patch.announce !== undefined) await api(path, 'POST', { action: patch.announce ? 'announcement' : 'not_announcement' });
      if (patch.locked !== undefined) await api(path, 'POST', { action: patch.locked ? 'locked' : 'unlocked' });
      if (patch.ephemeral !== undefined) await api(`/group/toggleEphemeral/${instance}${q(groupId)}`, 'POST', { expiration: patch.ephemeral });
    },
    async setGroupPicture(groupId, image) {
      // Evolution cambia la foto pero no tiene cómo sacarla.
      if (!image) throw new ProviderError('unsupported');
      await api(`/group/updateGroupPicture/${instance}${q(groupId)}`, 'POST', { image: image.url });
    },
    async joinGroup(code) {
      const r = (await api(`/group/acceptInviteCode/${instance}?inviteCode=${encodeURIComponent(code)}`)) as Json;
      const id = String(r.groupJid ?? r.id ?? (typeof r.accepted === 'string' ? r.accepted : ''));
      if (!id || !isGroupJid(id)) throw new ProviderError(r.accepted === false ? 'not_found' : 'provider_error');
      return { id };
    },
    async leaveGroup(groupId) {
      await api(`/group/leaveGroup/${instance}${q(groupId)}`, 'DELETE');
    },
    // Evolution no firma los webhooks: alcanza con el secreto de la URL.
    verifyWebhook: () => true,
    parseWebhook: parseEvolutionWebhook,
  };
}

export function bridgeProvider(
  kind: Extract<ProviderKind, 'waha' | 'evolution'>,
  cfg: BridgeConfig,
  opts: { fetch?: FetchLike; webhookSecret?: string } = {},
): GroupsProvider {
  return kind === 'waha' ? wahaProvider(cfg, opts) : evolutionProvider(cfg, opts);
}
