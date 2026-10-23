import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { hmacHex, parsePhoneList, phoneDigits, type FetchLike } from '@/lib/groups-provider';
import { cloudProvider, parseCloudWebhook, verifyMetaSignature } from '@/lib/groups-provider-cloud';
import { evolutionProvider, parseEvolutionWebhook, parseWahaWebhook, verifyWahaHmac, wahaProvider } from '@/lib/groups-provider-bridge';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import {
  allowedSends,
  chatVariables,
  isTicketBreached,
  isUnansweredDue,
  matchKeyword,
  normalizeSettings,
  reactionCreatesTicket,
  renderVariables,
  ticketDue,
  ticketTitleFrom,
} from '@/lib/groups-rules';
import {
  connectNumber,
  createGroups,
  createNumber,
  getChatRow,
  getNumberRowById,
  ingestEvents,
  listChats,
  listMembers,
  listMessages,
  listNumbers,
  parseGroupsCsv,
  sendMessage,
  updateMembers,
  updateSettings,
} from '@/lib/groups';
import { createTicket, listTickets, markBreachedTickets } from '@/lib/groups-tickets';
import { cancelBroadcast, createBroadcast, getBroadcast, processBroadcasts } from '@/lib/groups-broadcasts';
import { flagUnansweredChats } from '@/lib/groups-cron';
import { firstResponses, median } from '@/lib/groups-analytics';
import { makeUser } from './helpers';

const webhookRoute = await import('@/app/api/groups/webhook/[id]/[secret]/route');

/** fetch simulado que guarda cada llamada y responde según la ruta. */
function mockFetch(handler: (url: string, init: RequestInit) => unknown | Response) {
  const calls: Array<{ url: string; init: RequestInit; body: unknown }> = [];
  const f: FetchLike = async (url, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    const out = handler(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

// ======================================================================
// Adaptadores
// ======================================================================

describe('Cloud API (Meta)', () => {
  const cfg = { phoneNumberId: '1111', accessToken: 'tok-secret', appSecret: 'app-secret', verifyToken: 'verify-123' };

  it('manda texto con Bearer y contexto de respuesta', async () => {
    const { f, calls } = mockFetch(() => ({ messages: [{ id: 'wamid.1' }] }));
    const p = cloudProvider(cfg, f);
    const res = await p.sendText('+54 9 11 5555-0000', 'hola', { replyTo: 'wamid.0' });
    expect(res.id).toBe('wamid.1');
    expect(calls[0].url).toBe('https://graph.facebook.com/v21.0/1111/messages');
    expect(header(calls[0].init, 'authorization')).toBe('Bearer tok-secret');
    expect(calls[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '5491155550000', type: 'text', text: { body: 'hola' }, context: { message_id: 'wamid.0' } });
  });

  it('media, reacción y plantilla con el tipo correcto', async () => {
    const { f, calls } = mockFetch(() => ({ messages: [{ id: 'x' }] }));
    const p = cloudProvider(cfg, f);
    await p.sendMedia('5491155550000', { url: 'https://cdn.example.com/a.pdf', mimetype: 'application/pdf', filename: 'a.pdf', caption: 'factura' });
    await p.react('5491155550000', 'wamid.9', '👍', false);
    await p.sendTemplate('5491155550000', 'hello', 'es', ['Ana']);
    expect(calls[0].body).toMatchObject({ type: 'document', document: { link: 'https://cdn.example.com/a.pdf', filename: 'a.pdf', caption: 'factura' } });
    expect(calls[1].body).toMatchObject({ type: 'reaction', reaction: { message_id: 'wamid.9', emoji: '👍' } });
    expect(calls[2].body).toMatchObject({ type: 'template', template: { name: 'hello', language: { code: 'es' }, components: [{ type: 'body' }] } });
  });

  it('un 401 es auth_failed y el error no lleva el token', async () => {
    const { f } = mockFetch(() => new Response('{"error":{"message":"Invalid OAuth access token tok-secret"}}', { status: 401 }));
    const err = await cloudProvider(cfg, f).sendText('5491155550000', 'x').catch((e) => e);
    expect(err.code).toBe('auth_failed');
    expect(String(err.message)).not.toContain('tok-secret');
  });

  it('no gestiona grupos', async () => {
    const p = cloudProvider(cfg, mockFetch(() => ({})).f);
    expect(p.caps.groups).toBe(false);
    await expect(p.createGroup('x', [])).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('firma X-Hub-Signature-256', () => {
    const body = '{"a":1}';
    const sig = `sha256=${hmacHex('sha256', 'app-secret', body)}`;
    expect(verifyMetaSignature(body, sig, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(body + ' ', sig, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, null, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=abc', 'app-secret')).toBe(false);
  });

  it('normaliza mensajes, reacciones, media y estados del webhook', () => {
    const events = parseCloudWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '5491155550000', profile: { name: 'Ana' } }],
                messages: [
                  { from: '5491155550000', id: 'wamid.A', timestamp: '1760000000', type: 'text', text: { body: 'hola' }, context: { id: 'wamid.0' } },
                  { from: '5491155550000', id: 'wamid.B', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'foto' } },
                  { from: '5491155550000', id: 'wamid.C', type: 'reaction', reaction: { message_id: 'wamid.A', emoji: '🎫' } },
                ],
                statuses: [{ id: 'wamid.out', status: 'read' }],
              },
            },
          ],
        },
      ],
    });
    expect(events[0]).toMatchObject({ type: 'message', chatId: '5491155550000', senderName: 'Ana', body: 'hola', replyToProviderId: 'wamid.0', isGroup: false });
    expect(events[1]).toMatchObject({ type: 'message', body: 'foto', media: { url: 'meta:MEDIA1', type: 'image/jpeg' } });
    expect(events[2]).toMatchObject({ type: 'reaction', targetProviderMessageId: 'wamid.A', emoji: '🎫' });
    expect(events[3]).toEqual({ type: 'status', providerMessageId: 'wamid.out', status: 'read' });
  });
});

describe('WAHA', () => {
  const cfg = { baseUrl: 'https://waha.example.com/', apiKey: 'waha-key', session: 'acme' };

  it('crea grupos, agrega miembros y pide el link con X-Api-Key', async () => {
    const { f, calls } = mockFetch((url) => {
      if (url.endsWith('/api/acme/groups')) return { gid: { _serialized: '123-456@g.us' } };
      if (url.includes('invite-code')) return new Response('AbCdEf', { status: 200 });
      return {};
    });
    const p = wahaProvider(cfg, { fetch: f });
    const g = await p.createGroup('Acme', ['+15550001001']);
    expect(g.id).toBe('123-456@g.us');
    expect(calls[0].url).toBe('https://waha.example.com/api/acme/groups');
    expect(header(calls[0].init, 'x-api-key')).toBe('waha-key');
    expect(calls[0].body).toEqual({ name: 'Acme', participants: [{ id: '15550001001@c.us' }] });
    await p.updateParticipants('123-456@g.us', 'promote', ['15550001001']);
    expect(calls[1].url).toBe('https://waha.example.com/api/acme/groups/123-456%40g.us/admin/promote');
    expect(await p.inviteLink('123-456@g.us')).toBe('https://chat.whatsapp.com/AbCdEf');
  });

  it('conectar registra el webhook con HMAC y devuelve el QR', async () => {
    const { f, calls } = mockFetch((url) => {
      if (url.endsWith('/api/sessions/acme')) return { status: 'SCAN_QR_CODE' };
      if (url.includes('/auth/qr')) return { mimetype: 'image/png', data: 'QUJD' };
      return {};
    });
    const state = await wahaProvider(cfg, { fetch: f, webhookSecret: 'sec' }).connect('https://app.example.com/hook');
    expect(calls[0].body).toMatchObject({ name: 'acme', start: true, config: { webhooks: [{ url: 'https://app.example.com/hook', hmac: { key: 'sec' } }] } });
    expect(state).toEqual({ status: 'qr', qr: 'data:image/png;base64,QUJD', phone: undefined });
  });

  it('normaliza mensajes de grupo, propios, reacciones y acks', () => {
    const inGroup = parseWahaWebhook({
      event: 'message.any',
      payload: { id: 'false_123@g.us_A', from: '123-456@g.us', fromMe: false, participant: '5491155550000@c.us', body: 'hola', _data: { notifyName: 'Ana' }, timestamp: 1760000000 },
    });
    expect(inGroup[0]).toMatchObject({ type: 'message', chatId: '123-456@g.us', isGroup: true, senderPhone: '5491155550000', senderName: 'Ana', fromMe: false });
    const mine = parseWahaWebhook({ event: 'message.any', payload: { id: 'true_x', from: 'me@c.us', to: '5491155550000@c.us', fromMe: true, body: 'ok' } });
    expect(mine[0]).toMatchObject({ chatId: '5491155550000@c.us', fromMe: true });
    expect(parseWahaWebhook({ event: 'message.reaction', payload: { from: '123-456@g.us', participant: '1@c.us', reaction: { text: '🎫', messageId: 'false_A' } } })[0]).toMatchObject({
      type: 'reaction',
      targetProviderMessageId: 'false_A',
    });
    expect(parseWahaWebhook({ event: 'message.ack', payload: { id: 'true_x', ackName: 'READ' } })[0]).toEqual({ type: 'status', providerMessageId: 'true_x', status: 'read' });
    expect(parseWahaWebhook({ event: 'message.any', payload: { id: 'x', from: 'status@broadcast', body: 'story' } })).toEqual([]);
  });

  it('HMAC SHA-512 si el gateway lo manda', () => {
    const rawBody = '{"event":"message"}';
    const ok = new Headers({ 'x-webhook-hmac': hmacHex('sha512', 'sec', rawBody) });
    expect(verifyWahaHmac({ headers: ok, rawBody }, 'sec')).toBe(true);
    expect(verifyWahaHmac({ headers: new Headers({ 'x-webhook-hmac': 'bad' }), rawBody }, 'sec')).toBe(false);
    expect(verifyWahaHmac({ headers: new Headers(), rawBody }, 'sec')).toBe(true);
  });
});

describe('Evolution API', () => {
  const cfg = { baseUrl: 'https://evo.example.com', apiKey: 'evo-key', session: 'acme' };

  it('texto con apikey y resultado por participante', async () => {
    const { f, calls } = mockFetch((url) => {
      if (url.includes('/message/sendText/')) return { key: { id: 'BAE5' } };
      if (url.includes('/group/updateParticipant/'))
        return { updateParticipants: [{ jid: '15550001001@s.whatsapp.net', status: '200' }, { jid: '15550001099@s.whatsapp.net', status: '403' }] };
      return {};
    });
    const p = evolutionProvider(cfg, { fetch: f });
    expect((await p.sendText('123@g.us', 'hola')).id).toBe('BAE5');
    expect(header(calls[0].init, 'apikey')).toBe('evo-key');
    expect(calls[0].body).toEqual({ number: '123@g.us', text: 'hola' });
    const res = await p.updateParticipants('123@g.us', 'add', ['15550001001', '15550001099']);
    expect(calls[1].url).toBe('https://evo.example.com/group/updateParticipant/acme?groupJid=123%40g.us');
    expect(res).toEqual([
      { phone: '15550001001', ok: true },
      { phone: '15550001099', ok: false, error: 'whatsapp_403' },
    ]);
  });

  it('normaliza upsert, reacciones, updates y conexión', () => {
    const ev = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '123@g.us', fromMe: false, id: 'M1', participant: '5491155550000@s.whatsapp.net' },
        pushName: 'Ana',
        message: { extendedTextMessage: { text: 'necesito ayuda', contextInfo: { stanzaId: 'M0' } } },
        messageTimestamp: 1760000000,
      },
    });
    expect(ev[0]).toMatchObject({ type: 'message', chatId: '123@g.us', isGroup: true, senderPhone: '5491155550000', body: 'necesito ayuda', replyToProviderId: 'M0' });
    const r = parseEvolutionWebhook({ event: 'MESSAGES_UPSERT', data: { key: { remoteJid: '123@g.us', id: 'R1', fromMe: true }, message: { reactionMessage: { key: { id: 'M1' }, text: '🎫' } } } });
    expect(r[0]).toMatchObject({ type: 'reaction', targetProviderMessageId: 'M1', emoji: '🎫', fromMe: true });
    expect(parseEvolutionWebhook({ event: 'messages.update', data: { keyId: 'M1', status: 'DELIVERY_ACK' } })[0]).toMatchObject({ status: 'delivered' });
    expect(parseEvolutionWebhook({ event: 'connection.update', data: { state: 'open' } })[0]).toMatchObject({ type: 'session', status: 'connected' });
  });
});

describe('helpers de teléfonos y CSV', () => {
  it('normaliza y separa teléfonos', () => {
    expect(phoneDigits('+54 9 (11) 5555-0000')).toBe('5491155550000');
    expect(phoneDigits('5491155550000@c.us')).toBe('5491155550000');
    expect(parsePhoneList('+5491155550000, 123; +1 555 000 1001\n+5491155550000')).toEqual({ valid: ['5491155550000', '15550001001'], invalid: ['123'] });
  });

  it('CSV de grupos con columnas en español y errores por línea', () => {
    const { rows, errors } = parseGroupsCsv([
      ['nombre', 'participantes', 'descripción'],
      ['Acme', '+5491155550000 +15550001001', 'Soporte'],
      ['', '', ''],
      ['', '+5491155550000', ''],
      ['Globex', '123', ''],
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Acme', 'Globex']);
    expect(rows[0].phones).toEqual(['5491155550000', '15550001001']);
    expect(errors).toEqual([
      { line: 4, error: 'invalid_name' },
      { line: 5, error: 'invalid_phone:123' },
    ]);
    expect(parseGroupsCsv([['x', 'y']]).errors[0].error).toBe('missing_name_column');
  });
});

// ======================================================================
// Reglas
// ======================================================================

describe('reglas de tickets y SLA', () => {
  it('palabra clave como palabra entera, sin tildes ni mayúsculas', () => {
    expect(matchKeyword(['urgente', 'refund'], 'Es URGENTE, por favor')).toBe('urgente');
    expect(matchKeyword(['urgente'], 'urgentemente')).toBeNull();
    expect(matchKeyword(['devolución'], 'quiero una devolucion')).toBe('devolución');
    expect(matchKeyword([], 'hola')).toBeNull();
  });

  it('emoji de ticket sin selector de variante', () => {
    expect(reactionCreatesTicket({ ticketEmoji: '🎫' }, '🎫️')).toBe(true);
    expect(reactionCreatesTicket({ ticketEmoji: '🎫' }, '👍')).toBe(false);
    expect(reactionCreatesTicket({ ticketEmoji: '' }, '🎫')).toBe(false);
  });

  it('vencimientos por prioridad y ticket vencido', () => {
    const s = normalizeSettings({ firstResponseMin: 30, resolutionMin: { urgent: 60 } });
    const from = new Date('2026-01-01T10:00:00Z');
    const due = ticketDue('urgent', s, from);
    expect(due).toEqual({ firstResponseDueAt: '2026-01-01T10:30:00.000Z', dueAt: '2026-01-01T11:00:00.000Z' });
    const t = { status: 'open' as const, due_at: due.dueAt, first_response_due_at: due.firstResponseDueAt, first_response_at: null };
    expect(isTicketBreached(t, new Date('2026-01-01T10:20:00Z'))).toBe(false);
    expect(isTicketBreached(t, new Date('2026-01-01T10:31:00Z'))).toBe(true);
    expect(isTicketBreached({ ...t, first_response_at: '2026-01-01T10:05:00Z' }, new Date('2026-01-01T10:31:00Z'))).toBe(false);
    expect(isTicketBreached({ ...t, status: 'resolved' }, new Date('2026-02-01T00:00:00Z'))).toBe(false);
  });

  it('ajustes inválidos vuelven a los valores por defecto', () => {
    const s = normalizeSettings({ unansweredMin: -5, defaultPriority: 'mega', ticketKeywords: ['  OK  ', 'x', 'ok'] });
    expect(s.unansweredMin).toBe(30);
    expect(s.defaultPriority).toBe('medium');
    expect(s.ticketKeywords).toEqual(['ok']);
  });

  it('título del ticket y sin responder', () => {
    expect(ticketTitleFrom('\n  Primera línea\nsegunda')).toBe('Primera línea');
    expect(ticketTitleFrom('a'.repeat(200)).length).toBe(120);
    const now = new Date('2026-01-01T10:40:00Z');
    expect(isUnansweredDue('2026-01-01T10:00:00Z', 30, now)).toBe(true);
    expect(isUnansweredDue('2026-01-01T10:20:00Z', 30, now)).toBe(false);
    expect(isUnansweredDue(null, 30, now)).toBe(false);
  });
});

describe('ritmo de envíos masivos', () => {
  const now = 1_000_000_000;
  it('ventana deslizante por envío y tope por número', () => {
    expect(allowedSends({ perMinute: 20, broadcastSentAt: [], numberSentAt: [], now })).toBe(20);
    const recent = Array.from({ length: 15 }, (_, i) => now - i * 1000);
    expect(allowedSends({ perMinute: 20, broadcastSentAt: recent, numberSentAt: recent, now })).toBe(5);
    // Lo de hace más de un minuto ya no cuenta.
    expect(allowedSends({ perMinute: 20, broadcastSentAt: [now - 61_000], numberSentAt: [now - 61_000], now })).toBe(20);
    // El número ya mandó 58 por otros envíos: quedan 2 aunque este envío vaya a 20.
    expect(allowedSends({ perMinute: 20, broadcastSentAt: [], numberSentAt: Array(58).fill(now - 5000), now })).toBe(2);
    expect(allowedSends({ perMinute: 500, broadcastSentAt: [], numberSentAt: [], now })).toBe(60);
  });

  it('variables del mensaje', () => {
    const vars = chatVariables({ name: 'Ana Pérez', phone: '5491155550000', properties: { plan: 'Pro' } });
    expect(renderVariables('Hola {{first_name}} ({{ phone }}), plan {{prop.plan}} {{nada}}', vars)).toBe('Hola Ana (+5491155550000), plan Pro ');
  });
});

describe('métricas', () => {
  it('primera respuesta por tanda y mediana', () => {
    const m = (chat: string, direction: 'in' | 'out', minute: number, author: string | null = null, kind = 'person') => ({
      chat_id: chat,
      direction,
      author_id: author,
      author_kind: kind,
      created_at: new Date(Date.UTC(2026, 0, 1, 10, minute)).toISOString(),
    });
    const fr = firstResponses([m('a', 'in', 0), m('a', 'in', 2), m('a', 'out', 10, 'u1'), m('a', 'in', 20), m('a', 'out', 21, null, 'broadcast'), m('a', 'out', 25, 'u2')]);
    expect(fr).toEqual([
      { chatId: 'a', minutes: 10, by: 'u1' },
      { chatId: 'a', minutes: 5, by: 'u2' },
    ]);
    expect(median([5, 10])).toBe(8);
    expect(median([])).toBeNull();
  });
});

// ======================================================================
// Con base: números, webhook, tickets, envíos
// ======================================================================

async function setupFake() {
  const user = await makeUser('groups');
  const number = await createNumber(user.id, user.id, { provider: 'fake', name: 'Demo' });
  await connectNumber(user.id, number.id);
  const row = (await getNumberRowById(number.id))!;
  return { user, number, row };
}

async function settleFake(numberId: string) {
  // La sesión del falso cuenta 1,5 s desde connect.
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(numberId);
  if (s) s.connectedAt = Date.now() - 5000;
}

const inbound = (chatId: string, id: string, body: string, extra: Record<string, unknown> = {}) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: 'Ana',
  providerMessageId: id,
  body,
  ...extra,
});

describe('números y credenciales', () => {
  it('la config se guarda cifrada y el DTO no devuelve secretos', async () => {
    const user = await makeUser('groups-cred');
    const n = await createNumber(user.id, user.id, {
      provider: 'waha',
      config: { baseUrl: 'https://waha.example.com', apiKey: 'super-secret-key', session: 'acme' },
    });
    const raw = (await getDb().prepare('SELECT config FROM groups_numbers WHERE id = ?').get(n.id)) as { config: string };
    expect(raw.config.startsWith('enc:v1:')).toBe(true);
    expect(raw.config).not.toContain('super-secret-key');
    const dto = (await listNumbers(user.id))[0];
    expect(JSON.stringify(dto)).not.toContain('super-secret-key');
    expect(dto.configured.apiKey).toBe(true);
    expect(dto.settings).toMatchObject({ baseUrl: 'https://waha.example.com', session: 'acme' });
  });

  it('valida la config de cada proveedor y el falso solo con el flag', async () => {
    const user = await makeUser('groups-val');
    await expect(createNumber(user.id, user.id, { provider: 'cloud', config: { phoneNumberId: 'abc' } })).rejects.toMatchObject({ code: 'invalid_phone_number_id' });
    await expect(createNumber(user.id, user.id, { provider: 'waha', config: { baseUrl: 'ftp://x', apiKey: 'k' } })).rejects.toMatchObject({ code: 'invalid_base_url' });
    vi.stubEnv('GROUPS_FAKE', '0');
    await expect(createNumber(user.id, user.id, { provider: 'fake' })).rejects.toMatchObject({ code: 'invalid_provider' });
  });
});

describe('webhook', () => {
  it('Meta: firma inválida 401, válida guarda; repetido no duplica', async () => {
    const user = await makeUser('groups-meta');
    const n = await createNumber(user.id, user.id, {
      provider: 'cloud',
      config: { phoneNumberId: '12345', accessToken: 'tok', appSecret: 'app-secret', verifyToken: 'verify-token-1' },
    });
    const row = (await getNumberRowById(n.id))!;
    const payload = JSON.stringify({
      entry: [{ changes: [{ value: { contacts: [{ wa_id: '5491155550000', profile: { name: 'Ana' } }], messages: [{ from: '5491155550000', id: 'wamid.DEDUPE', type: 'text', text: { body: 'hola' } }] } }] }],
    });
    const post = (sig: string, secret = row.webhook_secret) =>
      webhookRoute.POST(
        new Request(`http://localhost/api/groups/webhook/${row.id}/${secret}`, { method: 'POST', body: payload, headers: { 'x-hub-signature-256': sig } }),
        { params: Promise.resolve({ id: row.id, secret }) },
      );
    const good = `sha256=${hmacHex('sha256', 'app-secret', payload)}`;
    expect((await post('sha256=' + '0'.repeat(64))).status).toBe(401);
    expect((await post(good, 'wrong-secret')).status).toBe(404);
    const first = await post(good);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ messages: 1, duplicates: 0 });
    const again = await post(good);
    expect(await again.json()).toMatchObject({ messages: 0, duplicates: 1 });
    const chats = await listChats(user.id, user.id);
    expect(chats.rows).toHaveLength(1);
    expect(chats.rows[0]).toMatchObject({ name: 'Ana', kind: 'dm', unread: 1 });
    expect(chats.rows[0].awaitingSince).toBeTruthy();
  });

  it('Meta: verificación GET con el verify token', async () => {
    const user = await makeUser('groups-verify');
    const n = await createNumber(user.id, user.id, {
      provider: 'cloud',
      config: { phoneNumberId: '12345', accessToken: 'tok', appSecret: 'app', verifyToken: 'verify-token-2' },
    });
    const row = (await getNumberRowById(n.id))!;
    const get = (token: string) =>
      webhookRoute.GET(
        new Request(`http://localhost/x?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=CH42`),
        { params: Promise.resolve({ id: row.id, secret: row.webhook_secret }) },
      );
    expect((await get('nope')).status).toBe(403);
    const ok = await get('verify-token-2');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('CH42');
  });

  it('responder (desde la app o el teléfono) saca el chat de "sin responder"', async () => {
    const { user, row } = await setupFake();
    await settleFake(row.id);
    await ingestEvents(row, [inbound('120363000000000001@g.us', 'IN-1', 'hola equipo')]);
    let chat = (await listChats(user.id, user.id, { filter: 'unanswered' })).rows[0];
    expect(chat.kind).toBe('group');
    await sendMessage(user.id, user.id, chat.id, { body: 'Hola Ana' });
    expect((await listChats(user.id, user.id, { filter: 'unanswered' })).rows).toHaveLength(0);
    expect(fakeSent(row.id).map((s) => s.text)).toEqual(['Hola Ana']);
    await ingestEvents(row, [inbound('120363000000000001@g.us', 'IN-2', 'otra')]);
    await ingestEvents(row, [{ ...inbound('120363000000000001@g.us', 'OUT-PHONE', 'respondo del cel'), fromMe: true }]);
    chat = (await listChats(user.id, user.id)).rows[0];
    expect(chat.awaitingSince).toBeNull();
    const msgs = await listMessages(user.id, chat.id);
    expect(msgs.map((m) => m.direction)).toEqual(['in', 'out', 'in', 'out']);
  });
});

describe('tickets', () => {
  it('reacción con el emoji crea un ticket una sola vez; palabra clave también', async () => {
    const { user, row } = await setupFake();
    await settleFake(row.id);
    await updateSettings(user.id, { ticketKeywords: ['urgente'] });
    const gid = '120363000000000002@g.us';
    await ingestEvents(row, [inbound(gid, 'T-1', 'No llegó la factura')]);
    const react = { type: 'reaction' as const, chatId: gid, targetProviderMessageId: 'T-1', emoji: '🎫', senderPhone: '', senderName: '', fromMe: true };
    await ingestEvents(row, [react, react]);
    let tickets = await listTickets(user.id);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ source: 'reaction', title: 'No llegó la factura', status: 'open' });
    await ingestEvents(row, [inbound(gid, 'T-2', 'Esto es URGENTE')]);
    tickets = await listTickets(user.id);
    expect(tickets.map((t) => t.source).sort()).toEqual(['keyword', 'reaction']);
    expect(new Set(tickets.map((t) => t.number))).toEqual(new Set([1, 2]));
  });

  it('crear desde el mismo mensaje devuelve el existente y la primera respuesta se registra', async () => {
    const { user, row } = await setupFake();
    await settleFake(row.id);
    await ingestEvents(row, [inbound('5491155550000@c.us', 'D-1', 'ayuda')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const msg = (await listMessages(user.id, chat.id))[0];
    const a = await createTicket(user.id, user.id, { chatId: chat.id, messageId: msg.id });
    const b = await createTicket(user.id, user.id, { chatId: chat.id, messageId: msg.id });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.ticket.id).toBe(a.ticket.id);
    await sendMessage(user.id, user.id, chat.id, { body: 'Te ayudo' });
    expect((await listTickets(user.id))[0].firstResponseAt).toBeTruthy();
  });

  it('el cron marca vencidos una sola vez (compare-and-set)', async () => {
    const { user, row } = await setupFake();
    await settleFake(row.id);
    await ingestEvents(row, [inbound('5491155550001@c.us', 'B-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await createTicket(user.id, user.id, { chatId: chat.id, title: 'x', priority: 'urgent' });
    const later = new Date(Date.now() + 10 * 3600_000);
    const [n1, n2] = await Promise.all([markBreachedTickets(later), markBreachedTickets(later)]);
    // Cada ticket vencido se marca una vez aunque corran dos crons (otros tests dejan tickets abiertos).
    const marked = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_tickets WHERE breached_at = ?').get(later.toISOString())) as { c: number };
    expect(n1 + n2).toBe(Number(marked.c));
    expect(await markBreachedTickets(later)).toBe(0);
    expect((await listTickets(user.id, { breached: true })).length).toBe(1);
  });

  it('el cron marca chats sin responder pasado el umbral', async () => {
    const { user, row } = await setupFake();
    await updateSettings(user.id, { unansweredMin: 10 });
    await ingestEvents(row, [inbound('5491155550002@c.us', 'F-1', 'hola', { timestamp: new Date(Date.now() - 30 * 60_000).toISOString() })]);
    const flagged = await flagUnansweredChats(new Date());
    expect(flagged).toBeGreaterThanOrEqual(1);
    expect((await listChats(user.id, user.id, { filter: 'flagged' })).rows).toHaveLength(1);
  });
});

describe('grupos en lote', () => {
  it('crea grupos y agrega miembros con resultado por teléfono', async () => {
    const { user, row } = await setupFake();
    await settleFake(row.id);
    const res = await createGroups(user.id, row.id, [
      { name: 'Acme · Soporte', phones: ['+15550001001', '+15550001099'] },
      { name: '', phones: [] },
    ]);
    expect(res[0]).toMatchObject({ ok: true, notAdded: ['15550001099'] });
    expect(res[1]).toMatchObject({ ok: false, error: 'invalid_name' });
    const chatId = res[0].chatId!;
    expect((await listMembers(user.id, chatId)).map((m) => m.phone).sort()).toEqual(['15550000001', '15550001001']);
    const bulk = await updateMembers(user.id, [chatId], 'add', ['+15550002002', '+15550002099']);
    expect(bulk[0].results).toEqual([
      { phone: '15550002002', ok: true },
      { phone: '15550002099', ok: false, error: 'whatsapp_403' },
    ]);
    expect((await getChatRow(user.id, chatId))!.member_count).toBe(3);
  });
});

describe('envíos masivos', () => {
  it('manda al ritmo pedido, sin duplicar con dos corridas a la vez, y se puede cancelar', async () => {
    const { user, row } = await setupFake();
    await settleFake(row.id);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      await ingestEvents(row, [inbound(`5491155551${i}00@c.us`, `BR-${i}`, 'hola', { senderName: `Cliente ${i}` })]);
    }
    for (const c of (await listChats(user.id, user.id)).rows) ids.push(c.id);
    const b = await createBroadcast(user.id, user.id, { body: 'Hola {{first_name}}', chatIds: ids, perMinute: 3 });
    const [r1, r2] = await Promise.all([processBroadcasts({ gapMs: 0 }), processBroadcasts({ gapMs: 0 })]);
    expect(r1.sent + r2.sent).toBe(3);
    const sent = fakeSent(row.id).filter((s) => s.text.startsWith('Hola Cliente'));
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((s) => s.chatId)).size).toBe(3);
    // En el mismo minuto no sale nada más.
    expect((await processBroadcasts({ gapMs: 0 })).sent).toBe(0);
    const done = await cancelBroadcast(user.id, b.id);
    expect(done.status).toBe('cancelled');
    const detail = (await getBroadcast(user.id, b.id))!;
    expect(detail.recipients.filter((r) => r.status === 'sent')).toHaveLength(3);
    expect(detail.recipients.filter((r) => r.status === 'skipped')).toHaveLength(2);
  });

  it('un programado no sale antes de su hora', async () => {
    const { user, row } = await setupFake();
    await settleFake(row.id);
    await ingestEvents(row, [inbound('5491155559999@c.us', 'SCH-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const b = await createBroadcast(user.id, user.id, {
      body: 'recordatorio',
      chatIds: [chat.id],
      kind: 'scheduled',
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect((await processBroadcasts({ gapMs: 0, broadcastId: b.id })).sent).toBe(0);
    expect((await processBroadcasts({ gapMs: 0, broadcastId: b.id, now: new Date(Date.now() + 2 * 3600_000) })).sent).toBe(1);
    expect((await getBroadcast(user.id, b.id))!.broadcast.status).toBe('done');
  });
});
