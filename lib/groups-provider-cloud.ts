/**
 * Groups: adaptador de la WhatsApp Cloud API de Meta (oficial).
 *
 * - Envío: POST graph.facebook.com/<v>/<phone_number_id>/messages (texto,
 *   media por link, reacciones, plantillas).
 * - Recepción: el webhook de la app de Meta. La verificación GET compara
 *   hub.verify_token; cada POST trae X-Hub-Signature-256 = HMAC-SHA256 del
 *   cuerpo crudo con el App Secret.
 * - Grupos: no se gestionan por esta vía (la UI lo dice y ofrece el modo
 *   puente). Las llamadas de grupo tiran ProviderError('unsupported').
 * - Editar, borrar para todos y fijar no existen en la Cloud API; reenviar
 *   se resuelve mandando una copia (lib/groups-inbox.ts).
 * - Llamadas (Calling API): el webhook "calls" avisa connect y terminate
 *   (con duración) y los estados RINGING / ACCEPTED / REJECTED de las que
 *   inicia el negocio. Se registran en el chat. Atender o llamar desde la
 *   app necesita WebRTC (SDP) y Meta no graba el audio.
 */
import {
  PROVIDER_CAPS,
  ProviderError,
  errorFromStatus,
  hmacHex,
  phoneDigits,
  safeEqual,
  unsupported,
  type CallDirection,
  type CallStatus,
  type CloudConfig,
  type ConnectState,
  type FetchLike,
  type GroupsProvider,
  type InboundEvent,
  type MediaInput,
  type SendResult,
  type Template,
  type WebhookRequest,
} from './groups-provider';

const GRAPH = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v21.0';

type Json = Record<string, unknown>;

function mediaKind(mimetype: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Verifica X-Hub-Signature-256 ("sha256=<hex>") contra el App Secret. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  return safeEqual(m[1].toLowerCase(), hmacHex('sha256', appSecret, rawBody));
}

function tsIso(raw: unknown): string | undefined {
  const ts = Number(raw);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : undefined;
}

/** Un evento de `value.calls` (Calling API) → llamada normalizada. */
export function parseCloudCall(c: Json, nameOf: (waId: string) => string = () => ''): InboundEvent | null {
  const id = String(c.id ?? '');
  if (!id) return null;
  const direction: CallDirection = String(c.direction ?? '').toUpperCase() === 'BUSINESS_INITIATED' ? 'out' : 'in';
  const user = phoneDigits(String(direction === 'in' ? c.from ?? '' : c.to ?? ''));
  if (!user) return null;
  const event = String(c.event ?? '').toLowerCase();
  let status: CallStatus;
  let durationSec: number | undefined;
  if (event === 'connect') status = direction === 'in' ? 'ringing' : 'answered';
  else if (event === 'terminate') {
    const d = Number(c.duration);
    const started = Number(c.start_time);
    const st = (Array.isArray(c.status) ? c.status : [c.status]).map((x) => String(x ?? '').toUpperCase());
    if (Number.isFinite(d) && d > 0) durationSec = Math.round(d);
    else if (Number.isFinite(started) && started > 0 && Number(c.end_time) > started) durationSec = Math.round(Number(c.end_time) - started);
    status = durationSec ? 'ended' : st.includes('REJECTED') ? 'rejected' : 'missed';
  } else return null;
  return {
    type: 'call',
    chatId: user,
    callId: id,
    direction,
    status,
    senderPhone: user,
    senderName: nameOf(user),
    durationSec,
    timestamp: tsIso(c.timestamp),
  };
}

/** Webhook de Meta → eventos normalizados (mensajes, reacciones, estados y llamadas). */
export function parseCloudWebhook(body: unknown): InboundEvent[] {
  const out: InboundEvent[] = [];
  const entries = (body as Json)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as Json)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = ((change as Json)?.value ?? {}) as Json;
      const contacts = Array.isArray(value.contacts) ? (value.contacts as Json[]) : [];
      const nameOf = (waId: string) => {
        const c = contacts.find((x) => String(x.wa_id) === waId);
        return String(((c?.profile as Json) ?? {}).name ?? '');
      };
      for (const raw of Array.isArray(value.messages) ? (value.messages as Json[]) : []) {
        const from = phoneDigits(String(raw.from ?? ''));
        const id = String(raw.id ?? '');
        if (!from || !id) continue;
        const type = String(raw.type ?? 'text');
        const ts = Number(raw.timestamp);
        const timestamp = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : undefined;
        if (type === 'reaction') {
          const r = (raw.reaction ?? {}) as Json;
          out.push({
            type: 'reaction',
            chatId: from,
            targetProviderMessageId: String(r.message_id ?? ''),
            emoji: String(r.emoji ?? ''),
            senderPhone: from,
            senderName: nameOf(from),
            fromMe: false,
          });
          continue;
        }
        let body = '';
        let media: { url: string; type: string; name: string } | undefined;
        if (type === 'text') body = String(((raw.text as Json) ?? {}).body ?? '');
        else if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
          const m = (raw[type] ?? {}) as Json;
          body = String(m.caption ?? '');
          // La media de Meta se baja con el token: guardamos el id y la sirve /api/groups/media.
          media = { url: `meta:${String(m.id ?? '')}`, type: String(m.mime_type ?? type), name: String(m.filename ?? '') };
        } else if (type === 'button') body = String(((raw.button as Json) ?? {}).text ?? '');
        else if (type === 'interactive') {
          const i = (raw.interactive ?? {}) as Json;
          body = String(((i.button_reply as Json) ?? (i.list_reply as Json) ?? {}).title ?? '');
        } else if (type === 'location') body = '[location]';
        else body = `[${type}]`;
        const context = (raw.context ?? {}) as Json;
        out.push({
          type: 'message',
          chatId: from,
          isGroup: false,
          chatName: nameOf(from),
          fromMe: false,
          senderPhone: from,
          senderName: nameOf(from),
          providerMessageId: id,
          body,
          media,
          replyToProviderId: context.id ? String(context.id) : undefined,
          timestamp,
        });
      }
      for (const c of Array.isArray(value.calls) ? (value.calls as Json[]) : []) {
        const ev = parseCloudCall(c, nameOf);
        if (ev) out.push(ev);
      }
      for (const s of Array.isArray(value.statuses) ? (value.statuses as Json[]) : []) {
        const st = String(s.status ?? '');
        if (String(s.type ?? '') === 'call') {
          const map: Record<string, CallStatus> = { RINGING: 'ringing', ACCEPTED: 'answered', REJECTED: 'rejected' };
          const status = map[st.toUpperCase()];
          const to = phoneDigits(String(s.recipient_id ?? ''));
          if (status && to && s.id) {
            out.push({ type: 'call', chatId: to, callId: String(s.id), direction: 'out', status, senderPhone: to, timestamp: tsIso(s.timestamp) });
          }
          continue;
        }
        if (st === 'sent' || st === 'delivered' || st === 'read' || st === 'failed') {
          out.push({ type: 'status', providerMessageId: String(s.id ?? ''), status: st });
        }
      }
    }
  }
  return out;
}

export function cloudProvider(cfg: CloudConfig, fetchImpl: FetchLike = (u, i) => fetch(u, i)): GroupsProvider {
  const version = cfg.apiVersion || DEFAULT_VERSION;
  const base = `${GRAPH}/${version}`;

  async function call(path: string, init: RequestInit = {}): Promise<Json> {
    if (!cfg.phoneNumberId || !cfg.accessToken) throw new ProviderError('invalid_config');
    let res: Response;
    try {
      res = await fetchImpl(`${base}/${path}`, {
        ...init,
        headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      });
    } catch {
      throw new ProviderError('unreachable');
    }
    if (!res.ok) throw errorFromStatus(res.status);
    return ((await res.json().catch(() => ({}))) ?? {}) as Json;
  }

  async function send(payload: Json): Promise<SendResult> {
    const data = await call(`${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    });
    const id = String(((data.messages as Json[] | undefined)?.[0] ?? {}).id ?? '');
    if (!id) throw new ProviderError('provider_error');
    return { id };
  }

  async function state(): Promise<ConnectState> {
    const data = await call(`${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name`);
    return { status: 'connected', phone: phoneDigits(String(data.display_phone_number ?? '')) };
  }

  return {
    kind: 'cloud',
    caps: PROVIDER_CAPS.cloud,
    // El webhook se configura en la app de Meta (no hay API para registrarlo por número).
    connect: () => state(),
    state,
    disconnect: async () => {},
    sendText: (chatId, text, opts) =>
      send({
        to: phoneDigits(chatId),
        type: 'text',
        text: { body: text, preview_url: true },
        ...(opts?.replyTo ? { context: { message_id: opts.replyTo } } : {}),
      }),
    sendMedia: (chatId, media: MediaInput) => {
      const kind = mediaKind(media.mimetype);
      const obj: Json = { link: media.url };
      if (media.caption && kind !== 'audio') obj.caption = media.caption;
      if (kind === 'document') obj.filename = media.filename;
      return send({ to: phoneDigits(chatId), type: kind, [kind]: obj });
    },
    react: async (chatId, messageId, emoji) => {
      await send({ to: phoneDigits(chatId), type: 'reaction', reaction: { message_id: messageId, emoji } });
    },
    sendTemplate: (chatId, name, language, params) =>
      send({
        to: phoneDigits(chatId),
        type: 'template',
        template: {
          name,
          language: { code: language },
          ...(params.length
            ? { components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] }
            : {}),
        },
      }),
    listTemplates: async (): Promise<Template[]> => {
      if (!cfg.wabaId) return [];
      const data = await call(`${encodeURIComponent(cfg.wabaId)}/message_templates?limit=100`);
      const rows = Array.isArray(data.data) ? (data.data as Json[]) : [];
      return rows.map((t) => {
        const comps = Array.isArray(t.components) ? (t.components as Json[]) : [];
        const body = comps.find((c) => String(c.type).toUpperCase() === 'BODY');
        return {
          name: String(t.name ?? ''),
          language: String(t.language ?? ''),
          status: String(t.status ?? ''),
          body: String(body?.text ?? ''),
        };
      });
    },
    listGroups: async () => [],
    createGroup: async () => unsupported(),
    participants: async () => unsupported(),
    updateParticipants: async () => unsupported(),
    inviteLink: async () => unsupported(),
    updateGroup: async () => unsupported(),
    editMessage: async () => unsupported(),
    deleteMessage: async () => unsupported(),
    pinMessage: async () => unsupported(),
    forwardMessage: async () => unsupported(),
    verifyWebhook: (req: WebhookRequest) => verifyMetaSignature(req.rawBody, req.headers.get('x-hub-signature-256'), cfg.appSecret),
    parseWebhook: parseCloudWebhook,
  };
}

/** Baja una media de Meta (id → URL firmada → bytes) con el token del número. */
export async function fetchCloudMedia(
  cfg: CloudConfig,
  mediaId: string,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<Response> {
  const version = cfg.apiVersion || DEFAULT_VERSION;
  const auth = { authorization: `Bearer ${cfg.accessToken}` };
  const meta = await fetchImpl(`${GRAPH}/${version}/${encodeURIComponent(mediaId)}`, { headers: auth });
  if (!meta.ok) throw errorFromStatus(meta.status);
  const info = (await meta.json()) as Json;
  const url = String(info.url ?? '');
  if (!/^https:\/\/[^/]*(fbsbx\.com|facebook\.com|whatsapp\.net)\//.test(url)) throw new ProviderError('provider_error');
  const file = await fetchImpl(url, { headers: auth });
  if (!file.ok) throw errorFromStatus(file.status);
  return file;
}
