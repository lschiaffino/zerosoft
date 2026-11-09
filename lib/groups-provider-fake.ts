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
 * - El webhook acepta eventos ya normalizados: { events: InboundEvent[] }.
 * - Edita, borra para todos, fija y reenvía (lo deja en `sent` para los tests).
 * - Entrar por invitación: cualquier código de 6+ letras entra a un grupo
 *   nuevo, salvo los que empiezan con "bad" (link vencido).
 */
import { randomUUID } from 'crypto';
import { deflateSync } from 'zlib';
import {
  PROVIDER_CAPS,
  ProviderError,
  phoneDigits,
  type ConnectState,
  type GroupInfo,
  type GroupsProvider,
  type InboundEvent,
  type Participant,
} from './groups-provider';

export function fakeProviderAllowed(): boolean {
  if (process.env.GROUPS_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

interface FakeGroup extends GroupInfo {
  participants: Participant[];
  inviteCode: string;
  ephemeral?: number;
  picture?: string;
  left?: boolean;
}

export interface FakeSent {
  chatId: string;
  text: string;
  kind: 'text' | 'media' | 'reaction' | 'edit' | 'delete' | 'pin' | 'unpin' | 'forward' | 'poll' | 'contact' | 'read' | 'block';
  at: number;
}

interface FakeState {
  connectedAt: number | null;
  groups: Map<string, FakeGroup>;
  sent: FakeSent[];
  /** Asuntos de grupos que llegaron por webhook (para chatInfo). */
  chatNames?: Map<string, string>;
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
  const send = (chatId: string, text: string, kind: FakeSent['kind']) => {
    requireConnected();
    s.sent.push({ chatId, text, kind, at: Date.now() });
    return { id: `fake-out-${randomUUID()}` };
  };

  async function state(): Promise<ConnectState> {
    if (s.connectedAt === null) return { status: 'disconnected' };
    return connected() ? { status: 'connected', phone: '15550000001' } : { status: 'qr', qr: QR_SVG };
  }

  return {
    kind: 'fake',
    caps: PROVIDER_CAPS.fake,
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
        if (g) return { name: g.name, about: g.description ?? '', pictureUrl: g.picture || pic, participants: g.participants.map((p) => ({ phone: p.phone, role: p.role })), size: g.participants.length };
        return { name: s.chatNames?.get(chatId) ?? `Grupo ${digits.slice(-4)}`, about: '', pictureUrl: pic, participants: [{ phone: '15550000001', role: 'superadmin' }], size: 1 };
      }
      return { name: '', about: digits.endsWith('1') ? '' : 'Disponible', pictureUrl: pic };
    },
    async connect() {
      s.connectedAt = s.connectedAt ?? Date.now();
      return state();
    },
    state,
    async disconnect() {
      s.connectedAt = null;
    },
    sendText: async (chatId, text) => send(chatId, text, 'text'),
    sendMedia: async (chatId, media) => send(chatId, media.caption ?? media.filename, 'media'),
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
    sendPresence: async () => undefined,
    /** Archivos inventados según el prefijo del id: "aud-" audio, "vid-" o "doc-" documento, el resto una foto. */
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
      return group(groupId).participants.map((p) => ({ ...p }));
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
      const out = events.filter((e): e is InboundEvent => {
        const t = (e as { type?: unknown })?.type;
        return ['message', 'reaction', 'status', 'participants', 'session', 'edit', 'revoke', 'call', 'poll_vote', 'contact', 'presence'].includes(String(t));
      });
      // El asunto que llegó con el mensaje es el que devuelve chatInfo (como el servidor real).
      for (const e of out) {
        if (e.type === 'message' && e.isGroup && e.chatName) (s.chatNames ??= new Map()).set(e.chatId, e.chatName);
      }
      return out;
    },
  };
}
