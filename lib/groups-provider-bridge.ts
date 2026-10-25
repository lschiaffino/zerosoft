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
import { safeFetch, UnsafeUrlError } from './safe-fetch';
import {
  PROVIDER_CAPS,
  ProviderError,
  type CallStatus,
  errorFromStatus,
  hmacHex,
  isGroupJid,
  phoneDigits,
  safeEqual,
  type BridgeConfig,
  type ConnectState,
  type ConnectStatus,
  type FetchLike,
  type GroupInfo,
  type GroupsProvider,
  type InboundEvent,
  type MemberRole,
  type Participant,
  type ParticipantAction,
  type ParticipantResult,
  type ProviderKind,
  type WebhookRequest,
} from './groups-provider';

type Json = Record<string, unknown>;

const defaultFetch: FetchLike = (url, init) => safeFetch(url, init, 15_000);

function baseOf(cfg: BridgeConfig): string {
  const base = String(cfg.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new ProviderError('invalid_config');
  return base;
}

async function request(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  method: string,
  body?: unknown,
): Promise<unknown> {
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
  if (!res.ok) throw errorFromStatus(res.status);
  const text = await res.text().catch(() => '');
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
        },
      ];
    }
    case 'message.edited': {
      const target = String(p.editedMessageId ?? '');
      const chatId = String(p.fromMe === true ? p.to ?? '' : p.from ?? '');
      if (!target || !chatId) return [];
      return [{ type: 'edit', chatId, providerMessageId: target, body: String(p.body ?? '') }];
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
  const f = opts.fetch ?? defaultFetch;
  const session = encodeURIComponent(cfg.session || 'default');
  const headers = { 'x-api-key': cfg.apiKey ?? '' };
  const api = (path: string, method = 'GET', body?: unknown) => request(f, `${baseOf(cfg)}${path}`, headers, method, body);
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

const EVOLUTION_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'CONNECTION_UPDATE',
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

/** Texto y media de un `message` de Baileys (lo que manda Evolution). */
function baileysContent(message: Json): {
  body: string;
  media?: { url: string; type: string; name: string };
  replyTo?: string;
  reaction?: Json;
  /** protocolMessage: edición (texto nuevo) o borrado para todos del mensaje `target`. */
  protocol?: { kind: 'edit' | 'revoke'; target: string; body: string };
} {
  const proto = (message.protocolMessage ?? ((((message.editedMessage ?? {}) as Json).message ?? {}) as Json).protocolMessage) as Json | undefined;
  if (proto) {
    const target = String(((proto.key ?? {}) as Json).id ?? '');
    const type = String(proto.type ?? '').toUpperCase();
    if (target && (type === 'REVOKE' || type === '0')) return { body: '', protocol: { kind: 'revoke', target, body: '' } };
    if (target && (type === 'MESSAGE_EDIT' || type === '14')) {
      const edited = (proto.editedMessage ?? {}) as Json;
      const text = typeof edited.conversation === 'string' ? edited.conversation : String(((edited.extendedTextMessage ?? {}) as Json).text ?? '');
      return { body: text, protocol: { kind: 'edit', target, body: text } };
    }
    return { body: '' };
  }
  if (message.reactionMessage) return { body: '', reaction: message.reactionMessage as Json };
  if (typeof message.conversation === 'string') return { body: message.conversation };
  const ext = message.extendedTextMessage as Json | undefined;
  if (ext) {
    const ctx = (ext.contextInfo ?? {}) as Json;
    return { body: String(ext.text ?? ''), replyTo: ctx.stanzaId ? String(ctx.stanzaId) : undefined };
  }
  for (const key of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
    const m = message[key] as Json | undefined;
    if (m) {
      const ctx = (m.contextInfo ?? {}) as Json;
      return {
        body: String(m.caption ?? ''),
        // La URL de WhatsApp está cifrada: se guarda el tipo y el nombre, no el archivo.
        media: { url: '', type: String(m.mimetype ?? key.replace('Message', '')), name: String(m.fileName ?? '') },
        replyTo: ctx.stanzaId ? String(ctx.stanzaId) : undefined,
      };
    }
  }
  return { body: '' };
}

/** Webhook de Evolution API → eventos normalizados. */
export function parseEvolutionWebhook(body: unknown): InboundEvent[] {
  const b = (body ?? {}) as Json;
  const event = String(b.event ?? '').toLowerCase().replace(/_/g, '.');
  const d = (b.data ?? {}) as Json;
  switch (event) {
    case 'messages.upsert': {
      const rows = Array.isArray(d) ? (d as Json[]) : [d];
      const out: InboundEvent[] = [];
      for (const m of rows) {
        const key = (m.key ?? {}) as Json;
        const chatId = String(key.remoteJid ?? '');
        const id = String(key.id ?? '');
        if (!chatId || !id || chatId === 'status@broadcast') continue;
        const isGroup = isGroupJid(chatId);
        const fromMe = key.fromMe === true;
        const content = baileysContent((m.message ?? {}) as Json);
        const sender = isGroup ? String(key.participant ?? m.participant ?? '') : fromMe ? '' : chatId;
        if (content.protocol) {
          out.push(
            content.protocol.kind === 'edit'
              ? { type: 'edit', chatId, providerMessageId: content.protocol.target, body: content.protocol.body }
              : { type: 'revoke', chatId, providerMessageId: content.protocol.target },
          );
          continue;
        }
        if (content.reaction) {
          const target = ((content.reaction.key ?? {}) as Json).id;
          if (!target) continue;
          out.push({
            type: 'reaction',
            chatId,
            targetProviderMessageId: String(target),
            emoji: String(content.reaction.text ?? ''),
            senderPhone: phoneDigits(sender),
            senderName: String(m.pushName ?? ''),
            fromMe,
          });
          continue;
        }
        const ts = Number(m.messageTimestamp);
        out.push({
          type: 'message',
          chatId,
          isGroup,
          fromMe,
          senderPhone: phoneDigits(sender),
          senderName: String(m.pushName ?? ''),
          providerMessageId: id,
          body: content.body,
          media: content.media,
          replyToProviderId: content.replyTo,
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : undefined,
        });
      }
      return out;
    }
    case 'messages.update': {
      const rows = Array.isArray(d) ? (d as Json[]) : [d];
      const out: InboundEvent[] = [];
      for (const u of rows) {
        const st = EVOLUTION_ACK[String(u.status ?? '').toUpperCase()];
        const id = String(u.keyId ?? ((u.key ?? {}) as Json).id ?? '');
        if (st && id) out.push({ type: 'status', providerMessageId: id, status: st });
      }
      return out;
    }
    case 'messages.delete': {
      const key = ((d.key ?? d) as Json) ?? {};
      const id = String(key.id ?? '');
      const chatId = String(key.remoteJid ?? '');
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
      return [{ type: 'participants', chatId: String(d.id), action, phones: parts.map((p) => phoneDigits(idString(p))) }];
    }
    default:
      return [];
  }
}

export function evolutionProvider(cfg: BridgeConfig, opts: { fetch?: FetchLike } = {}): GroupsProvider {
  const f = opts.fetch ?? defaultFetch;
  const instance = encodeURIComponent(cfg.session || 'zerosoft');
  const headers = { apikey: cfg.apiKey ?? '' };
  const api = (path: string, method = 'GET', body?: unknown) => request(f, `${baseOf(cfg)}${path}`, headers, method, body);
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
    async connect(webhookUrl) {
      const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVOLUTION_EVENTS };
      try {
        await api('/instance/create', 'POST', {
          instanceName: cfg.session || 'zerosoft',
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          webhook,
        });
      } catch (err) {
        if (!(err instanceof ProviderError) || ![400, 403, 409].includes(err.httpStatus ?? 0)) throw err;
        await api(`/webhook/set/${instance}`, 'POST', { webhook });
      }
      return state();
    },
    state,
    async disconnect() {
      await api(`/instance/logout/${instance}`, 'DELETE').catch(() => null);
    },
    async sendText(chatId, text, o) {
      const r = (await api(`/message/sendText/${instance}`, 'POST', {
        number: chatId,
        text,
        ...(o?.replyTo ? { quoted: { key: { id: o.replyTo } } } : {}),
      })) as Json;
      return { id: String(((r.key ?? {}) as Json).id ?? '') };
    },
    async sendMedia(chatId, media) {
      const mediatype = media.mimetype.startsWith('image/')
        ? 'image'
        : media.mimetype.startsWith('video/')
          ? 'video'
          : media.mimetype.startsWith('audio/')
            ? 'audio'
            : 'document';
      const r = (await api(`/message/sendMedia/${instance}`, 'POST', {
        number: chatId,
        mediatype,
        mimetype: media.mimetype,
        media: media.url,
        fileName: media.filename,
        caption: media.caption ?? '',
      })) as Json;
      return { id: String(((r.key ?? {}) as Json).id ?? '') };
    },
    async react(chatId, messageId, emoji, fromMe) {
      await api(`/message/sendReaction/${instance}`, 'POST', { key: { remoteJid: chatId, fromMe, id: messageId }, reaction: emoji });
    },
    sendTemplate: async () => {
      throw new ProviderError('unsupported');
    },
    listTemplates: async () => [],
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
      return rows.map((p) => ({ phone: phoneDigits(String(p.id ?? '')), role: roleOf(p.admin) }));
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
