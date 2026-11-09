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
 * - Historial guardado (como Evolution con base): solo en los números de Inbox
 *   y con INBOX_FAKE_HISTORY=1, tres chats fijos (uno con 230 mensajes, para
 *   paginar). Sin la variable el historial está vacío.
 */
import { randomUUID } from 'crypto';
import {
  PROVIDER_CAPS,
  ProviderError,
  phoneDigits,
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
  inviteCode: string;
  ephemeral?: number;
  picture?: string;
  left?: boolean;
}

export interface FakeSent {
  chatId: string;
  text: string;
  kind: 'text' | 'media' | 'reaction' | 'edit' | 'delete' | 'pin' | 'unpin' | 'forward' | 'poll' | 'contact' | 'read';
  at: number;
}

interface FakeState {
  connectedAt: number | null;
  groups: Map<string, FakeGroup>;
  sent: FakeSent[];
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

function fakeHistory(): HistorySource {
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
    async contacts() {
      return [];
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
    ...(numberId.startsWith('inbox-') ? { history: fakeHistory() } : {}),
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
      return events.filter((e): e is InboundEvent => {
        const t = (e as { type?: unknown })?.type;
        return ['message', 'reaction', 'status', 'participants', 'session', 'edit', 'revoke', 'call', 'poll_vote', 'contact', 'presence'].includes(String(t));
      });
    },
  };
}
