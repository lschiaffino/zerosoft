/**
 * Groups: proveedor falso para tests y demo. Guarda todo en memoria (en
 * globalThis, para que lo compartan las rutas del mismo proceso) y nunca sale
 * a la red.
 *
 * Solo se activa con GROUPS_FAKE=1 y además NODE_ENV=test o DEMO_MODE=true
 * (mismo patrón que CRM_IMPORT_FAKE). En producción normal nunca.
 *
 * - Conectar muestra un QR y a los ~1,5 s queda "conectado" (como si se
 *   escaneara).
 * - Los teléfonos que terminan en 99 rechazan altas a grupos (privacidad).
 * - Archivar en WhatsApp: queda en fakeArchives() con el mensaje de
 *   referencia; fakeFailArchives(n) hace fallar los próximos n (reintentos).
 * - El webhook acepta eventos ya normalizados: { events: InboundEvent[] }.
 * - Edita, borra para todos, fija y reenvía (lo deja en `sent` para los tests).
 * - Entrar por invitación: cualquier código de 6+ letras entra a un grupo
 *   nuevo, salvo los que empiezan con "bad" (link vencido).
 * - Historial guardado (como Evolution con base): solo en los números de Inbox
 *   y con INBOX_FAKE_HISTORY=1, tres chats fijos (uno con 230 mensajes, para
 *   paginar). Sin la variable el historial está vacío.
 * - Libreta de contactos del servidor: un evento `{ type: 'fake_contacts',
 *   contacts: [{ phone?, lid?, name?, about?, groups? }] }` en el webhook la
 *   cambia sin pasar por la app (como si la persona renombrara a alguien en el
 *   teléfono). La devuelven findContacts (historial de Inbox), chatInfo
 *   (nombre, info, participantes con lid y nombre) y participants. `groups`
 *   suma a la persona a esos grupos (solo con lid si no trae teléfono).
 * - Mensajes que no se pudieron descifrar (como Evolution con el parche 0002):
 *   un evento `{ type: 'fake_withheld', message: <evento message> }` llega a
 *   la app como `missing` y el número se guarda el mensaje; fetchHistory del
 *   chat lo devuelve como historial (fakeHistoryRequests() lista los pedidos).
 */
import { randomUUID } from 'crypto';
import { deflateSync } from 'zlib';
import { FAKE_ANIMATED_STICKER_WEBP, FAKE_STICKER_WEBP } from './wa-sticker-fixtures';
import {
  PROVIDER_CAPS,
  ProviderError,
  phoneDigits,
  type ArchiveRef,
  type ConnectState,
  type GroupInfo,
  type GroupsProvider,
  type HistoryChat,
  type HistorySource,
  type InboundEvent,
  type Participant,
} from './groups-provider';

export function fakeProviderAllowed(): boolean {
  if (process.env.GROUPS_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

interface FakeGroup extends GroupInfo {
  participants: Participant[];
  /** Participantes que solo se ven por su lid (sin teléfono). */
  lids?: string[];
  inviteCode: string;
  ephemeral?: number;
  picture?: string;
  left?: boolean;
}

export interface FakeSent {
  chatId: string;
  text: string;
  kind: 'text' | 'media' | 'reaction' | 'edit' | 'delete' | 'pin' | 'unpin' | 'forward' | 'poll' | 'contact' | 'read' | 'block' | 'archive';
  at: number;
  /** Media: el tipo de mensaje de WhatsApp, el mimetype y si fue en base64 (tests). */
  media?: { kind: string; mimetype: string; base64: boolean };
  /** Teléfonos mencionados (textos en grupos). */
  mentions?: string[];
}

interface FakeState {
  connectedAt: number | null;
  groups: Map<string, FakeGroup>;
  sent: FakeSent[];
  /** Asuntos de grupos que llegaron por webhook (para chatInfo). */
  chatNames?: Map<string, string>;
  /** Libreta de contactos del servidor (por teléfono o "lid:<dígitos>"). */
  directory?: Map<string, FakeContact>;
  /** Cada archivar o desarchivar que pidió la app, con su mensaje de referencia (tests). */
  archives?: FakeArchive[];
  /** Cuántos archivar seguidos fallan (el servidor no responde): para probar los reintentos. */
  failArchives?: number;
  /** Mensajes que "no se pudieron descifrar", por chat: los devuelve fetchHistory. */
  withheld?: Map<string, InboundEvent[]>;
  /** Cada pedido de historial que hizo la app (tests). */
  historyRequests?: FakeHistoryRequest[];
}

export interface FakeHistoryRequest {
  chatId: string;
  count: number;
  after?: number;
  at: number;
}

export interface FakeArchive {
  chatId: string;
  archive: boolean;
  last?: ArchiveRef;
  at: number;
}

export interface FakeContact {
  phone?: string;
  lid?: string;
  name?: string;
  about?: string;
}

function directoryOf(s: FakeState): Map<string, FakeContact> {
  return (s.directory ??= new Map());
}

function findContact(s: FakeState, key: { phone?: string; lid?: string }): FakeContact | undefined {
  const dir = directoryOf(s);
  return (key.phone ? dir.get(key.phone) : undefined) ?? (key.lid ? dir.get(`lid:${key.lid}`) ?? [...dir.values()].find((c) => c.lid === key.lid) : undefined);
}

/** Aplica un `fake_contacts` del webhook a la libreta (y a los grupos que nombra). */
function applyFakeContacts(s: FakeState, raw: unknown): void {
  const list = Array.isArray(raw) ? raw : [];
  const dir = directoryOf(s);
  for (const r of list.slice(0, 500)) {
    const c = (r ?? {}) as { phone?: unknown; lid?: unknown; name?: unknown; about?: unknown; groups?: unknown };
    const phone = String(c.phone ?? '').replace(/\D/g, '');
    const lid = String(c.lid ?? '').replace(/\D/g, '');
    if (!phone && !lid) continue;
    const prev = findContact(s, { phone, lid }) ?? {};
    const next: FakeContact = {
      ...prev,
      ...(phone ? { phone } : {}),
      ...(lid ? { lid } : {}),
      ...(typeof c.name === 'string' ? { name: c.name } : {}),
      ...(typeof c.about === 'string' ? { about: c.about } : {}),
    };
    if (next.phone) {
      dir.delete(`lid:${next.lid ?? ''}`);
      dir.set(next.phone, next);
    } else dir.set(`lid:${next.lid}`, next);
    for (const gid of Array.isArray(c.groups) ? c.groups.map(String) : []) {
      if (!gid.endsWith('@g.us')) continue;
      let g = s.groups.get(gid);
      if (!g) {
        g = { id: gid, name: s.chatNames?.get(gid) ?? '', description: '', participants: [{ phone: '15550000001', role: 'superadmin' }], inviteCode: randomUUID().slice(0, 8) };
        s.groups.set(gid, g);
      }
      if (next.phone) {
        if (!g.participants.some((p) => p.phone === next.phone)) g.participants.push({ phone: next.phone, role: 'member' });
      } else if (next.lid && !(g.lids ??= []).includes(next.lid)) g.lids.push(next.lid);
    }
  }
}

const store = ((globalThis as unknown as { __groupsFake?: Map<string, FakeState> }).__groupsFake ??= new Map());

const QR_SVG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/><path fill="#000" d="M0 0h7v7H0zM14 0h7v7h-7zM0 14h7v7H0zM2 2h3v3H2zM16 2h3v3h-3zM2 16h3v3H2zM9 1h1v1H9zM11 3h2v1h-2zM8 8h5v1H8zM9 10h1v3H9zM12 11h3v1h-3zM15 14h2v2h-2zM18 17h2v3h-2zM10 16h3v1h-3z"/><path fill="#fff" d="M1 1h5v5H1zM15 1h5v5h-5zM1 15h5v5H1z"/><path fill="#000" d="M2 2h3v3H2zM16 2h3v3h-3zM2 16h3v3H2z"/></svg>',
  ).toString('base64');

function seedGroups(): Map<string, FakeGroup> {
  const g = new Map<string, FakeGroup>();
  const add = (id: string, name: string, phones: string[]) =>
    g.set(id, {
      id,
      name,
      description: '',
      participants: phones.map((phone, i) => ({ phone, role: i === 0 ? 'superadmin' : 'member', name: '' })),
      inviteCode: randomUUID().slice(0, 8),
    });
  add('120363000000000001@g.us', 'Acme support', ['15550000001', '15550001001', '15550001002']);
  add('120363000000000002@g.us', 'Globex onboarding', ['15550000001', '15550002001']);
  return g;
}

function stateFor(numberId: string): FakeState {
  let s = store.get(numberId);
  if (!s) {
    s = { connectedAt: null, groups: seedGroups(), sent: [] };
    store.set(numberId, s);
  }
  return s;
}

/** Lo que mandó el número falso (tests). */
export function fakeSent(numberId: string): FakeSent[] {
  return stateFor(numberId).sent;
}

/** Los archivar/desarchivar que recibió el número falso, con la referencia que mandó la app (tests). */
export function fakeArchives(numberId: string): FakeArchive[] {
  return (stateFor(numberId).archives ??= []);
}

/** Los pedidos de historial que recibió el número falso (tests). */
export function fakeHistoryRequests(numberId: string): FakeHistoryRequest[] {
  return (stateFor(numberId).historyRequests ??= []);
}

/** Un `fake_withheld` del webhook: el número se guarda el mensaje y la app se entera de que falta. */
function withhold(s: FakeState, raw: unknown): InboundEvent | null {
  const m = (raw ?? {}) as Partial<Extract<InboundEvent, { type: 'message' }>>;
  if (typeof m.chatId !== 'string' || typeof m.providerMessageId !== 'string' || !m.chatId || !m.providerMessageId) return null;
  const msg = { ...m, type: 'message' } as Extract<InboundEvent, { type: 'message' }>;
  const map = (s.withheld ??= new Map());
  map.set(m.chatId, [...(map.get(m.chatId) ?? []), msg]);
  return { type: 'missing', chatId: m.chatId, messageId: m.providerMessageId, fromMe: m.fromMe === true, ...(m.timestamp ? { timestamp: m.timestamp } : {}) };
}

/** Los próximos `n` archivar del número falso fallan con 'unreachable' (tests). */
export function fakeFailArchives(numberId: string, n: number): void {
  stateFor(numberId).failArchives = Math.max(0, n);
}

/** Estado de un grupo del número falso (tests). */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG de un degradé (para las fotos del proveedor falso). */
export function fakePng(width = 320, height = 200, seed = 0): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = (40 + seed * 37 + (x * 180) / width) & 255;
      raw[row + 2 + x * 3] = (90 + (y * 120) / height) & 255;
      raw[row + 3 + x * 3] = (160 - (x * 60) / width) & 255;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Un segundo de silencio en WAV (audio del proveedor falso). */
function fakeWav(seconds = 2): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b;
}

function fakeMedia(id: string): { data: Buffer; mimetype: string; filename: string } {
  if (id.startsWith('astk-')) return { data: FAKE_ANIMATED_STICKER_WEBP, mimetype: 'image/webp', filename: '' };
  if (id.startsWith('stk-')) return { data: FAKE_STICKER_WEBP, mimetype: 'image/webp', filename: '' };
  if (id.startsWith('aud-')) return { data: fakeWav(), mimetype: 'audio/wav', filename: 'audio.wav' };
  if (id.startsWith('doc-') || id.startsWith('vid-')) return { data: Buffer.from('%PDF-1.4\n% archivo de prueba\n'), mimetype: 'application/pdf', filename: 'documento.pdf' };
  return { data: fakePng(480, 320, id.length % 5), mimetype: 'image/png', filename: 'foto.png' };
}

/** Foto de perfil falsa: un cuadrado de color que sale del número (data URL, nunca sale a la red). */
function fakePicture(digits: string): string {
  let h = 0;
  for (const c of digits) h = (h * 31 + c.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${h} 45% 55%)"/><circle cx="32" cy="26" r="12" fill="#fff" fill-opacity=".85"/><rect x="14" y="42" width="36" height="22" rx="11" fill="#fff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function fakeGroupState(numberId: string, groupId: string): (GroupInfo & { ephemeral?: number; picture?: string; left?: boolean; participants: Participant[] }) | null {
  return stateFor(numberId).groups.get(groupId) ?? null;
}

export function resetFakeProvider(): void {
  store.clear();
}

/** Chats del historial falso: id, nombre, grupo y cantidad de mensajes. */
export const FAKE_HISTORY_CHATS: ReadonlyArray<{ chatId: string; name: string; isGroup: boolean; count: number }> = [
  { chatId: '5491170000001@s.whatsapp.net', name: 'Historial Ana', isGroup: false, count: 230 },
  { chatId: '5491170000002@s.whatsapp.net', name: 'Historial Beto', isGroup: false, count: 15 },
  { chatId: '120363000000000001@g.us', name: 'Historial Asado', isGroup: true, count: 40 },
];

/** Mensaje `n` (0 = el más viejo) de un chat del historial falso: uno por hora, terminando hace un día. */
function fakeHistoryEvent(c: (typeof FAKE_HISTORY_CHATS)[number], n: number): InboundEvent {
  const at = Date.UTC(2026, 0, 1) + n * 3600_000;
  const fromMe = n % 3 === 0;
  return {
    type: 'message',
    chatId: c.chatId,
    isGroup: c.isGroup,
    chatName: c.isGroup ? c.name : undefined,
    fromMe,
    senderPhone: fromMe ? '15550000001' : c.isGroup ? '5491170000009' : phoneDigits(c.chatId),
    senderName: fromMe ? '' : c.isGroup ? 'Tío Beto' : c.name,
    providerMessageId: `HIST${phoneDigits(c.chatId).slice(-4)}${String(n).padStart(4, '0')}`,
    body: `${c.name} mensaje ${n + 1}`,
    timestamp: new Date(at).toISOString(),
    history: true,
  } as InboundEvent;
}

function fakeHistory(s: FakeState): HistorySource {
  const on = process.env.INBOX_FAKE_HISTORY === '1';
  const chats = on ? FAKE_HISTORY_CHATS : [];
  const page = (remoteJid: string, size: number, p: number) => {
    const c = chats.find((x) => x.chatId === remoteJid);
    if (!c) return { events: [] as InboundEvent[], more: false, total: 0 };
    // Como findMessages: la página 1 son los más nuevos.
    const end = Math.max(0, c.count - (p - 1) * size);
    const start = Math.max(0, end - size);
    const events = Array.from({ length: end - start }, (_, i) => fakeHistoryEvent(c, start + i));
    return { events, more: start > 0, total: c.count };
  };
  return {
    async chats(p, size) {
      return chats.slice(p * size, (p + 1) * size).map(
        (c): HistoryChat => ({ remoteJid: c.chatId, chatId: c.chatId, isGroup: c.isGroup, name: c.name, pictureUrl: '', unread: 0, lastAt: Math.floor(Date.UTC(2026, 0, 1) / 1000) + c.count * 3600 }),
      );
    },
    async messages(remoteJid, limit, p = 1) {
      return page(remoteJid, limit, p).events;
    },
    async messagePage(remoteJid, size, p) {
      return page(remoteJid, size, p);
    },
    async contacts(p, size) {
      const all = [...directoryOf(s).values()];
      return all.slice(p * size, (p + 1) * size).map((c) => ({
        chatId: c.phone ? `${c.phone}@s.whatsapp.net` : `${c.lid}@lid`,
        name: c.name ?? '',
        pictureUrl: '',
        ...(c.lid ? { lid: c.lid } : {}),
        ...(c.phone ? { phone: c.phone } : {}),
      }));
    },
    async picture() {
      return '';
    },
  };
}

export function fakeProvider(numberId: string, opts: { instantConnect?: boolean } = {}): GroupsProvider {
  const s = stateFor(numberId);
  const group = (id: string) => {
    // Un grupo que llegó por webhook y no está en memoria: se crea al vuelo.
    let g = s.groups.get(id);
    if (!g) {
      if (!id.endsWith('@g.us')) throw new ProviderError('not_found', 404);
      g = { id, name: '', description: '', participants: [{ phone: '15550000001', role: 'superadmin' }], inviteCode: randomUUID().slice(0, 8) };
      s.groups.set(id, g);
    }
    return g;
  };
  const connected = () => s.connectedAt !== null && (opts.instantConnect || Date.now() - s.connectedAt >= 1500);
  const requireConnected = () => {
    if (!connected()) throw new ProviderError('not_connected');
  };
  const send = (chatId: string, text: string, kind: FakeSent['kind'], media?: FakeSent['media']) => {
    requireConnected();
    s.sent.push({ chatId, text, kind, at: Date.now(), ...(media ? { media } : {}) });
    return { id: `fake-out-${randomUUID()}` };
  };

  async function state(): Promise<ConnectState> {
    if (s.connectedAt === null) return { status: 'disconnected' };
    return connected() ? { status: 'connected', phone: '15550000001' } : { status: 'qr', qr: QR_SVG };
  }

  return {
    kind: 'fake',
    caps: PROVIDER_CAPS.fake,
    ...(numberId.startsWith('inbox-') ? { history: fakeHistory(s) } : {}),
    /**
     * Datos inventados: los grupos sembrados con su nombre; uno que llegó por
     * webhook, "Grupo NNNN". Foto (un SVG de color) solo si el número termina
     * en par, para probar las dos caras del avatar.
     */
    async chatInfo(chatId) {
      const digits = chatId.replace(/@.*/, '').replace(/\D/g, '');
      const pic = /[02468]$/.test(digits) ? fakePicture(digits) : '';
      if (chatId.endsWith('@g.us')) {
        const g = s.groups.get(chatId);
        if (g) {
          const participants = g.participants.map((p) => {
            const c = findContact(s, { phone: p.phone });
            return { phone: p.phone, role: p.role, ...(c?.lid ? { lid: c.lid } : {}), ...(c?.name ? { name: c.name } : {}) };
          });
          const lidParticipants = (g.lids ?? []).map((lid) => {
            const c = findContact(s, { lid });
            return { lid, ...(c?.name ? { name: c.name } : {}) };
          });
          return {
            name: g.name || s.chatNames?.get(chatId) || `Grupo ${digits.slice(-4)}`,
            about: g.description ?? '',
            pictureUrl: g.picture || pic,
            participants,
            ...(lidParticipants.length ? { lidParticipants } : {}),
            size: g.participants.length + (g.lids?.length ?? 0),
          };
        }
        return { name: s.chatNames?.get(chatId) ?? `Grupo ${digits.slice(-4)}`, about: '', pictureUrl: pic, participants: [{ phone: '15550000001', role: 'superadmin' }], size: 1 };
      }
      const known = findContact(s, { phone: digits });
      return { name: known?.name ?? '', about: known?.about ?? (digits.endsWith('1') ? '' : 'Disponible'), pictureUrl: pic };
    },
    async connect() {
      s.connectedAt = s.connectedAt ?? Date.now();
      return state();
    },
    state,
    async disconnect() {
      s.connectedAt = null;
    },
    sendText: async (chatId, text, o) => {
      const r = send(chatId, text, 'text');
      if (o?.mentions?.length) s.sent[s.sent.length - 1].mentions = [...o.mentions];
      return r;
    },
    sendMedia: async (chatId, media) => {
      const r = send(chatId, media.caption ?? media.filename, 'media', { kind: media.kind ?? '', mimetype: media.mimetype, base64: Boolean(media.base64) });
      return media.kind === 'sticker' ? { id: `stk-${r.id}` } : r;
    },
    react: async (chatId, _id, emoji) => {
      send(chatId, emoji, 'reaction');
    },
    sendTemplate: async () => {
      throw new ProviderError('unsupported');
    },
    sendPoll: async (chatId, poll) => send(chatId, `${poll.question} [${poll.options.join(' | ')}]`, 'poll'),
    sendContact: async (chatId, contacts) => send(chatId, contacts.map((c) => `${c.name} +${c.phone}`).join(' | '), 'contact'),
    markRead: async (chatId, ids) => void send(chatId, ids.join(','), 'read'),
    blockContact: async (chatId, block) => void send(chatId, block ? 'block' : 'unblock', 'block'),
    // Para probar "Chat nuevo": un teléfono que termina en 0000000 no tiene WhatsApp; el resto sí.
    checkNumber: async (phone) => {
      requireConnected();
      const digits = phone.replace(/\D/g, '');
      return /0{7}$/.test(digits) ? { exists: false } : { exists: true, jid: `${digits}@s.whatsapp.net` };
    },
    archiveChat: async (chatId, archive, last) => {
      requireConnected();
      if (s.failArchives) {
        s.failArchives--;
        throw new ProviderError('unreachable');
      }
      (s.archives ??= []).push({ chatId, archive, ...(last ? { last } : {}), at: Date.now() });
      void send(chatId, archive ? 'archive' : 'unarchive', 'archive');
    },
    sendPresence: async () => undefined,
    /** El historial del chat "desde el teléfono": lo que se guardó con fake_withheld, como historial. */
    fetchHistory: async (chatId, o) => {
      requireConnected();
      (s.historyRequests ??= []).push({ chatId, count: o.count, ...(o.after ? { after: o.after } : {}), at: Date.now() });
      const events = (s.withheld?.get(chatId) ?? []).map((e) => ({ ...e, history: true }));
      s.withheld?.delete(chatId);
      return { requestId: `fake-hist-${randomUUID()}`, events };
    },
    /** Archivos inventados según el prefijo del id: "aud-" audio, "vid-" o "doc-" documento, "stk-"/"astk-" sticker, el resto una foto. */
    async fetchMedia(ref) {
      return fakeMedia(ref.providerMessageId);
    },
    listTemplates: async () => [],
    async listGroups() {
      requireConnected();
      return [...s.groups.values()]
        .filter((g) => !g.left)
        .map((g) => ({ id: g.id, name: g.name, description: g.description, announce: g.announce ?? false, locked: g.locked ?? false }));
    },
    async createGroup(name, phones) {
      requireConnected();
      const id = `1203630${Date.now()}${Math.floor(Math.random() * 1000)}@g.us`;
      const g: FakeGroup = {
        id,
        name,
        description: '',
        participants: [
          { phone: '15550000001', role: 'superadmin' },
          ...phones.filter((p) => !p.endsWith('99')).map((phone) => ({ phone: phoneDigits(phone), role: 'member' as const })),
        ],
        inviteCode: randomUUID().slice(0, 8),
      };
      s.groups.set(id, g);
      return { id, name };
    },
    async participants(groupId) {
      requireConnected();
      return group(groupId).participants.map((p) => ({ ...p, name: p.name || findContact(s, { phone: p.phone })?.name || '' }));
    },
    async updateParticipants(groupId, action, phones) {
      requireConnected();
      const g = group(groupId);
      return phones.map((raw) => {
        const phone = phoneDigits(raw);
        const i = g.participants.findIndex((p) => p.phone === phone);
        if (action === 'add') {
          if (phone.endsWith('99')) return { phone, ok: false, error: 'whatsapp_403' };
          if (i < 0) g.participants.push({ phone, role: 'member' });
          return { phone, ok: true };
        }
        if (i < 0) return { phone, ok: false, error: 'not_member' };
        if (action === 'remove') g.participants.splice(i, 1);
        else g.participants[i].role = action === 'promote' ? 'admin' : 'member';
        return { phone, ok: true };
      });
    },
    async inviteLink(groupId, revoke) {
      requireConnected();
      const g = group(groupId);
      if (revoke) g.inviteCode = randomUUID().slice(0, 8);
      return `https://chat.whatsapp.com/FAKE${g.inviteCode}`;
    },
    async updateGroup(groupId, patch) {
      requireConnected();
      const g = group(groupId);
      if (patch.name !== undefined) g.name = patch.name;
      if (patch.description !== undefined) g.description = patch.description;
    },
    async editMessage(chatId, providerMessageId, text) {
      send(chatId, `${providerMessageId}:${text}`, 'edit');
    },
    async deleteMessage(chatId, providerMessageId) {
      send(chatId, providerMessageId, 'delete');
    },
    async pinMessage(chatId, providerMessageId, pin) {
      send(chatId, providerMessageId, pin ? 'pin' : 'unpin');
    },
    forwardMessage: async (toChatId, _fromChatId, providerMessageId) => send(toChatId, providerMessageId, 'forward'),
    async updateGroupSettings(groupId, patch) {
      requireConnected();
      const g = group(groupId);
      if (patch.announce !== undefined) g.announce = patch.announce;
      if (patch.locked !== undefined) g.locked = patch.locked;
      if (patch.ephemeral !== undefined) g.ephemeral = patch.ephemeral;
    },
    async setGroupPicture(groupId, image) {
      requireConnected();
      group(groupId).picture = image?.url ?? '';
    },
    async joinGroup(code) {
      requireConnected();
      if (code.toLowerCase().startsWith('bad')) throw new ProviderError('not_found', 404);
      const existing = [...s.groups.values()].find((g) => g.inviteCode === code.replace(/^FAKE/, ''));
      if (existing) {
        existing.left = false;
        if (!existing.participants.some((p) => p.phone === '15550000001')) existing.participants.push({ phone: '15550000001', role: 'member' });
        return { id: existing.id, name: existing.name };
      }
      const id = `1203631${Date.now()}${Math.floor(Math.random() * 1000)}@g.us`;
      const name = `Invited ${code.slice(0, 6)}`;
      s.groups.set(id, {
        id,
        name,
        description: '',
        participants: [
          { phone: '15550009000', role: 'superadmin' },
          { phone: '15550000001', role: 'member' },
        ],
        inviteCode: code,
      });
      return { id, name };
    },
    async leaveGroup(groupId) {
      requireConnected();
      const g = group(groupId);
      g.left = true;
      g.participants = g.participants.filter((p) => p.phone !== '15550000001');
    },
    verifyWebhook: () => true,
    parseWebhook(body) {
      const events = (body as { events?: unknown })?.events;
      if (!Array.isArray(events)) return [];
      // La libreta del servidor cambia sin que la app se entere (la trae el repaso diario).
      for (const e of events) if ((e as { type?: unknown })?.type === 'fake_contacts') applyFakeContacts(s, (e as { contacts?: unknown }).contacts);
      const out = events.flatMap((e): InboundEvent[] => {
        const t = (e as { type?: unknown })?.type;
        if (t === 'fake_withheld') {
          const missing = withhold(s, (e as { message?: unknown }).message);
          return missing ? [missing] : [];
        }
        return ['message', 'reaction', 'status', 'participants', 'session', 'edit', 'revoke', 'call', 'poll_vote', 'contact', 'presence', 'archive', 'missing'].includes(String(t)) ? [e as InboundEvent] : [];
      });
      // El asunto que llegó con el mensaje es el que devuelve chatInfo (como el servidor real).
      for (const e of out) {
        if (e.type === 'message' && e.isGroup && e.chatName) (s.chatNames ??= new Map()).set(e.chatId, e.chatName);
      }
      return out;
    },
  };
}
