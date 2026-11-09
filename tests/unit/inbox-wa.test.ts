/**
 * Inbox con la cara de WhatsApp: nombres reales (asunto del grupo, nunca el
 * id), foto servida con la sesión, reacciones, presencia, tildes que no
 * vuelven atrás y lo que muestra la fila de la lista. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createAccount, findThread, getAccountById, listMessages, listThreads, presenceOf, upsertThread, writeAccountConfig } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { applyReaction, avatarFor, groupParticipants, refreshStaleInfo } from '@/lib/inbox/wa-meta';
import { evolutionProvider } from '@/lib/groups-provider-bridge';
import { newManagedInstance } from '@/lib/groups-provider-managed';
import { chatName, formatPhone, groupReactions, previewKind, previewText } from '@/components/inbox/wa/util';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

const BRIDGE = 'https://evo.example.test';

beforeEach(() => {
  vi.stubEnv('INBOX_BRIDGE_URL', BRIDGE);
  vi.stubEnv('INBOX_BRIDGE_KEY', 'global-key-test');
  vi.stubEnv('GROUPS_FAKE', '');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function connected(prefix: string) {
  const u = await makeUser(prefix);
  const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'managed', label: 'WhatsApp' });
  await writeAccountConfig(a.id, newManagedInstance());
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(a.id);
  return { u, account: (await getAccountById(a.id))! };
}

const msg = (over: Partial<Extract<InboundEvent, { type: 'message' }>>): InboundEvent => ({
  type: 'message',
  chatId: '15550001001@s.whatsapp.net',
  isGroup: false,
  fromMe: false,
  senderPhone: '15550001001',
  senderName: 'Ana Prueba',
  providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
  body: 'hola',
  timestamp: new Date().toISOString(),
  ...over,
});

describe('formatos de la lista', () => {
  it('teléfonos con formato y nombre del chat sin ids crudos', () => {
    expect(formatPhone('5491155550000')).toBe('+54 9 11 5555-0000');
    expect(formatPhone('15550001001')).toBe('+1 555 000 1001');
    expect(formatPhone('5511987654321')).toBe('+55 11 98765-4321');
    expect(chatName({ title: '', handle: '', kind: 'group' }, 'Grupo')).toBe('Grupo');
    expect(chatName({ title: '5491149287832-1410039831', handle: '', kind: 'group' }, 'Grupo')).toBe('Grupo');
    expect(chatName({ title: 'Familia', handle: '', kind: 'group' }, 'Grupo')).toBe('Familia');
    expect(chatName({ title: '15550001001', handle: '15550001001', kind: 'dm' }, 'Grupo')).toBe('+1 555 000 1001');
    expect(chatName({ title: 'Ana', handle: '15550001001', kind: 'dm' }, 'Grupo')).toBe('Ana');
  });

  it('vista previa: "[image]" no es texto; el tipo da el ícono', () => {
    expect(previewText('[image]')).toBe('');
    expect(previewText('mirá esto')).toBe('mirá esto');
    expect(previewKind('voice', '[audio]')).toBe('voice');
    expect(previewKind('', '[document]')).toBe('document');
    expect(previewKind('', 'hola')).toBe('');
  });

  it('reacciones: una por persona, agrupadas por emoji', () => {
    let list = applyReaction([], { emoji: '👍', by: '1555', name: 'Ana' });
    list = applyReaction(list, { emoji: '❤️', by: 'me', name: '' });
    list = applyReaction(list, { emoji: '👍', by: '1666', name: 'Beto' });
    list = applyReaction(list, { emoji: '😂', by: '1555', name: 'Ana' });
    expect(list).toHaveLength(3);
    const g = groupReactions(list);
    expect(g.map((x) => x.emoji)).toEqual(['❤️', '👍', '😂']);
    expect(g.find((x) => x.emoji === '❤️')!.mine).toBe(true);
    expect(applyReaction(list, { emoji: '', by: 'me', name: '' })).toHaveLength(2);
  });

  it('presencia: escribiendo 25 s, en línea 5 min', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const at = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
    expect(presenceOf({ presence: 'composing', presence_at: at(5) }, now)).toBe('typing');
    expect(presenceOf({ presence: 'composing', presence_at: at(40) }, now)).toBe('online');
    expect(presenceOf({ presence: 'recording', presence_at: at(3) }, now)).toBe('recording');
    expect(presenceOf({ presence: 'available', presence_at: at(200) }, now)).toBe('online');
    expect(presenceOf({ presence: 'available', presence_at: at(400) }, now)).toBe('');
    expect(presenceOf({ presence: 'unavailable', presence_at: at(1) }, now)).toBe('');
  });
});

describe('ingesta de WhatsApp', () => {
  it('la fila guarda quién mandó, el tipo y las tildes; las tildes no vuelven atrás', async () => {
    const { u, account } = await connected('ibwa-row');
    await ingestWhatsappEvents(account, [
      msg({ chatId: '120363000000000077@g.us', isGroup: true, chatName: 'Club de lectura', senderName: 'Beto', body: '', media: { url: '', type: 'audio/ogg', name: '', info: { kind: 'voice', ptt: true, duration: 12 } } }),
    ]);
    let [th] = await listThreads(u.id, { view: 'groups' });
    expect(th).toMatchObject({ title: 'Club de lectura', lastSender: 'Beto', lastKind: 'voice', lastFromMe: false });
    const page = await listMessages(u.id, th.id);
    expect(page.messages[0].meta).toMatchObject({ ptt: true, duration: 12 });

    await ingestWhatsappEvents(account, [msg({ chatId: '120363000000000077@g.us', isGroup: true, fromMe: true, providerMessageId: 'out-1', body: 'voy', status: 'sent' })]);
    await ingestWhatsappEvents(account, [{ type: 'status', providerMessageId: 'out-1', status: 'read' }]);
    await ingestWhatsappEvents(account, [{ type: 'status', providerMessageId: 'out-1', status: 'delivered' }]);
    [th] = await listThreads(u.id, { view: 'groups' });
    expect(th).toMatchObject({ lastFromMe: true, lastStatus: 'read', lastSender: '' });
    const out = (await listMessages(u.id, th.id)).messages.find((m) => m.fromMe)!;
    expect(out.status).toBe('read');
  });

  it('reacciones en vivo (poner, cambiar, sacar) y respuesta con su cita', async () => {
    const { u, account } = await connected('ibwa-react');
    await ingestWhatsappEvents(account, [msg({ providerMessageId: 'base-1', body: '¿Vamos el sábado?' })]);
    await ingestWhatsappEvents(account, [msg({ providerMessageId: 'reply-1', fromMe: true, body: 'Dale', replyToProviderId: 'base-1', status: 'sent' })]);
    const react = (emoji: string, fromMe = false): InboundEvent => ({ type: 'reaction', chatId: '15550001001@s.whatsapp.net', targetProviderMessageId: 'base-1', emoji, senderPhone: fromMe ? '' : '15550001001', senderName: fromMe ? '' : 'Ana Prueba', fromMe });
    await ingestWhatsappEvents(account, [react('👍'), react('❤️', true)]);
    await ingestWhatsappEvents(account, [react('😂')]);
    const [th] = await listThreads(u.id, { view: 'whatsapp' });
    let page = await listMessages(u.id, th.id);
    const base = page.messages.find((m) => m.body === '¿Vamos el sábado?')!;
    expect(base.reactions!.map((r) => r.emoji).sort()).toEqual(['❤️', '😂']);
    const reply = page.messages.find((m) => m.body === 'Dale')!;
    expect(reply.reply).toMatchObject({ id: base.id, fromMe: false, body: '¿Vamos el sábado?' });
    await ingestWhatsappEvents(account, [react('', true)]);
    page = await listMessages(u.id, th.id);
    expect(page.messages.find((m) => m.id === base.id)!.reactions!.map((r) => r.emoji)).toEqual(['😂']);
  });

  it('presencia: "escribiendo" en el chat', async () => {
    const { u, account } = await connected('ibwa-presence');
    await ingestWhatsappEvents(account, [msg({ body: 'hola' })]);
    await ingestWhatsappEvents(account, [{ type: 'presence', chatId: '15550001001@s.whatsapp.net', who: '', state: 'composing' }]);
    const [th] = await listThreads(u.id, { view: 'whatsapp' });
    expect(th.presence).toBe('typing');
  });
});

describe('datos del chat por Evolution', () => {
  function evo(calls: string[]) {
    return async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      calls.push(`${init.method ?? 'GET'} ${url.pathname}${url.search}`);
      let out: unknown = {};
      if (url.pathname.startsWith('/group/findGroupInfos/')) {
        out = {
          id: url.searchParams.get('groupJid'),
          subject: 'Vecinos del 4B',
          pictureUrl: 'https://pps.whatsapp.net/v/t61/fake.jpg?oe=1',
          size: 3,
          creation: 1700000000,
          desc: 'Reglas: sin spam',
          participants: [
            { id: '100000000000001@lid', phoneNumber: '15550001001@s.whatsapp.net', admin: 'superadmin' },
            { id: '100000000000002@lid', phoneNumber: '15550001002@s.whatsapp.net', admin: null },
            { id: '100000000000003@lid', admin: null },
          ],
        };
      } else if (url.pathname.startsWith('/chat/fetchProfile/')) {
        out = { wuid: '15550001001@s.whatsapp.net', name: '', numberExists: true, picture: 'https://pps.whatsapp.net/v/t61/ana.jpg', status: { status: 'En el trabajo', setAt: '2026-01-01' }, isBusiness: false };
      }
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  }

  it('chatInfo: grupo con findGroupInfos (no fetchAllGroups) y persona con fetchProfile', async () => {
    const calls: string[] = [];
    const p = evolutionProvider({ baseUrl: BRIDGE, apiKey: 'k', session: 'inst' }, { fetch: evo(calls) });
    const g = await p.chatInfo!('120363000000000099@g.us');
    expect(g).toMatchObject({ name: 'Vecinos del 4B', about: 'Reglas: sin spam', size: 3, createdAt: 1700000000 });
    expect(g!.participants).toEqual([
      { phone: '15550001001', role: 'superadmin' },
      { phone: '15550001002', role: 'member' },
    ]);
    const d = await p.chatInfo!('15550001001@s.whatsapp.net');
    expect(d).toMatchObject({ name: '', about: 'En el trabajo', pictureUrl: 'https://pps.whatsapp.net/v/t61/ana.jpg' });
    expect(calls.some((c) => c.includes('fetchAllGroups'))).toBe(false);
  });

  it('un grupo sin asunto toma el nombre real y la foto; el 1:1 conserva el nombre propio', async () => {
    const { u, account } = await connected('ibwa-info');
    const calls: string[] = [];
    vi.stubGlobal('fetch', evo(calls));
    const g = await upsertThread(account, { externalId: '5491149287832-1410039831@g.us', kind: 'group' });
    const d = await upsertThread(account, { externalId: '15550001001@s.whatsapp.net', kind: 'dm', title: 'Ana (trabajo)', handle: '15550001001' });
    let list = await listThreads(u.id, { view: 'whatsapp' });
    expect(list.find((t) => t.id === g.id)!.title).toBe('');
    const n = await refreshStaleInfo(account);
    expect(n).toBe(2);
    list = await listThreads(u.id, { view: 'whatsapp' });
    const group = list.find((t) => t.id === g.id)!;
    expect(group.title).toBe('Vecinos del 4B');
    expect(group.avatar).toMatch(new RegExp(`^/api/inbox/avatar/${g.id}\\?v=[0-9a-f]{10}$`));
    expect(list.find((t) => t.id === d.id)!.title).toBe('Ana (trabajo)');
    // Otra corrida enseguida no vuelve a pedir nada (info_at reciente).
    calls.length = 0;
    expect(await refreshStaleInfo(account)).toBe(0);
    expect(calls).toHaveLength(0);
    // Participantes con nombre conocido (el del chat 1:1), admins primero.
    const ps = await groupParticipants(u.id, (await findThread(account.id, '5491149287832-1410039831@g.us'))!, '15550000001');
    expect(ps[0]).toMatchObject({ phone: '15550001001', role: 'superadmin', name: 'Ana (trabajo)', threadId: d.id });
  });

  it('la foto se sirve solo a la dueña y solo desde el servidor de WhatsApp', async () => {
    const { u, account } = await connected('ibwa-avatar');
    const other = await makeUser('ibwa-avatar-other');
    const t = await upsertThread(account, { externalId: '15550001001@s.whatsapp.net', kind: 'dm', handle: '15550001001' });
    await getDb().prepare('UPDATE inbox_threads SET avatar_url = ? WHERE id = ?').run('https://pps.whatsapp.net/v/t61/ana.jpg', t.id);
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const img = await avatarFor(u.id, t.id);
    expect(img.mime).toBe('image/jpeg');
    await expect(avatarFor(other.id, t.id)).rejects.toMatchObject({ code: 'not_found' });
    await getDb().prepare('UPDATE inbox_threads SET avatar_url = ? WHERE id = ?').run('https://evil.example.test/x.jpg', t.id);
    await expect(avatarFor(u.id, t.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});
