import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createNumber, getNumberRowById, ingestEvents, listChats, listMessages } from '@/lib/groups';
import { baileysContent, cleanPushName, evolutionMessageEvents, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { managedProvider } from '@/lib/groups-provider-managed';
import { getImportStatus, queueImport, runImportChunk, runImports } from '@/lib/groups-import';
import { buildEvolutionData, evolutionImportResponse } from '../support/evolution-fake';
import { makeUser } from './helpers';

const BRIDGE = 'https://bridge.example.test';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('GROUPS_BRIDGE_URL', BRIDGE);
  vi.stubEnv('GROUPS_BRIDGE_KEY', 'global');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubEvolution(data = buildEvolutionData()) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    calls.push(u.pathname);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const r = evolutionImportResponse(data, init.method ?? 'GET', u.pathname, u.searchParams, body, BRIDGE);
    if (r?.bytes) return new Response(new Uint8Array(r.bytes), { status: 200, headers: { 'content-type': r.type ?? 'application/octet-stream' } });
    if (r) return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    if (u.pathname.startsWith('/instance/connectionState')) return Response.json({ instance: { state: 'open' } });
    return Response.json({});
  });
  return { data, calls };
}

async function connectedNumber(tag: string) {
  const user = await makeUser(tag);
  const n = await createNumber(user.id, user.id, { provider: 'managed' });
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { user, row: (await getNumberRowById(n.id))! };
}

async function runToEnd(numberId: string) {
  for (let i = 0; i < 400; i++) {
    const st = await runImportChunk(numberId, { budgetMs: 60_000 });
    if (!st || st.status === 'done' || st.status === 'error') return st;
  }
  throw new Error('import did not finish');
}

describe('Evolution: mensajes guardados y del historial', () => {
  it('nombres: "Você" y dígitos no son nombres', () => {
    expect(cleanPushName('Você')).toBe('');
    expect(cleanPushName('5491155550000')).toBe('');
    expect(cleanPushName('  Ana  López ')).toBe('Ana López');
  });

  it('respuesta con el contextInfo afuera (como lo guarda Evolution), documento envuelto, nota de voz, sticker', () => {
    expect(baileysContent({ conversation: 'ok' }, { stanzaId: 'Q1' })).toMatchObject({ body: 'ok', replyTo: 'Q1' });
    const doc = baileysContent({ documentWithCaptionMessage: { message: { documentMessage: { fileName: 'a.pdf', mimetype: 'application/pdf', pageCount: 2, fileLength: 1000 } } } });
    expect(doc.media).toMatchObject({ type: 'application/pdf', name: 'a.pdf' });
    expect(doc.media?.info).toMatchObject({ kind: 'document', pages: 2 });
    expect(baileysContent({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 4 } }).media?.info).toMatchObject({ kind: 'voice', duration: 4 });
    expect(baileysContent({ stickerMessage: {} }).media?.type).toBe('image/webp');
    expect(baileysContent({ ephemeralMessage: { message: { conversation: 'temporal' } } }).body).toBe('temporal');
    expect(baileysContent({ locationMessage: { degreesLatitude: -34.6, degreesLongitude: -58.4, name: 'Oficina' } }).location).toMatchObject({ lat: -34.6, name: 'Oficina' });
    expect(baileysContent({ pollCreationMessageV3: { name: '¿Día?', options: [{ optionName: 'Lun' }, { optionName: 'Mar' }], selectableOptionsCount: 1 } }).poll).toEqual({ question: '¿Día?', options: ['Lun', 'Mar'], multi: false });
  });

  it('chat @lid usa el teléfono; lo propio sale como saliente con su estado', () => {
    const [ev] = evolutionMessageEvents(
      { key: { id: 'A', fromMe: true, remoteJid: '123@lid', remoteJidAlt: '5491100001111@s.whatsapp.net' }, pushName: 'Você', message: { conversation: 'hola' }, messageTimestamp: 1700000000, MessageUpdate: [{ status: 'DELIVERY_ACK' }, { status: 'READ' }] },
      true,
    );
    expect(ev).toMatchObject({ type: 'message', chatId: '5491100001111@s.whatsapp.net', fromMe: true, senderName: '', status: 'read', history: true });
  });

  it('messages.set del webhook se marca como historial; contacts.upsert da nombres', () => {
    const evs = parseEvolutionWebhook({ event: 'messages.set', data: [{ key: { id: 'H1', fromMe: false, remoteJid: '5491100002222@s.whatsapp.net' }, pushName: 'Rocío', message: { conversation: 'viejo' }, messageTimestamp: 1700000000 }] });
    expect(evs[0]).toMatchObject({ type: 'message', history: true });
    expect(parseEvolutionWebhook({ event: 'contacts.upsert', data: [{ remoteJid: '5491100002222@s.whatsapp.net', pushName: 'Rocío G' }] })).toEqual([
      { type: 'contact', chatId: '5491100002222@s.whatsapp.net', name: 'Rocío G' },
    ]);
  });
});

describe('Webhook del QR administrado', () => {
  it('apikey null (servidor sin exponer el token) cuenta como ausente; el nombre de la instancia sigue siendo estricto', async () => {
    const { row } = await connectedNumber('imp-null-key');
    const cfg = (await import('@/lib/groups')).readConfig(row) as { session: string; instanceToken: string };
    const p = managedProvider(cfg, { env: { baseUrl: BRIDGE, globalKey: 'g' } });
    const req = (body: unknown) => ({ headers: new Headers(), rawBody: JSON.stringify(body) });
    expect(p.verifyWebhook(req({ instance: cfg.session, apikey: null, event: 'messages.upsert' }), '')).toBe(true);
    expect(p.verifyWebhook(req({ instance: cfg.session, apikey: cfg.instanceToken }), '')).toBe(true);
    expect(p.verifyWebhook(req({ instance: cfg.session, apikey: 'otro' }), '')).toBe(false);
    expect(p.verifyWebhook(req({ instance: 'zs-00000000000000000000', apikey: null }), '')).toBe(false);
  });
});

describe('Importación al conectar', () => {
  it('trae 200 chats y los grupos con nombres, fotos, no leídos y mensajes, sin avisos ni SLA, y es idempotente', async () => {
    const { data, calls } = stubEvolution();
    const { user, row } = await connectedNumber('imp-full');
    expect(await queueImport(row, { perChat: 50 })).toBe(true);
    // Sin restart no se encola otra mientras hay una.
    expect(await queueImport(row)).toBe(false);
    const st = await runToEnd(row.id);
    expect(st?.status).toBe('done');
    const { rows, total } = await listChats(user.id, user.id, { limit: 500 });
    expect(total).toBe(data.chats.length);
    // Los @lid quedaron con su teléfono.
    expect(rows.every((c) => c.kind === 'group' || /^\d+$/.test(c.phone))).toBe(true);
    // Nombres: del contacto de la agenda, o del pushName del cliente; nunca "Você" ni dígitos.
    expect(rows.some((c) => c.name.endsWith('(agenda)'))).toBe(true);
    expect(rows.some((c) => c.name === 'Você' || /^\d{6,}$/.test(c.name))).toBe(false);
    const group = rows.find((c) => c.name === 'Clientes zona 1')!;
    expect(group.kind).toBe('group');
    expect(group.unread).toBe(5);
    expect(group.pictureUrl).not.toBe('');
    // Sin nada esperando respuesta ni marcado.
    expect(rows.every((c) => !c.awaitingSince && !c.flagged)).toBe(true);
    const counted = (await getDb().prepare('SELECT COUNT(*) AS n FROM groups_messages WHERE number_id = ?').get(row.id)) as { n: number };
    const expected = data.chats.reduce((a, c) => a + c.messages.filter((m) => m.messageType !== 'reactionMessage').length, 0);
    expect(Number(counted.n)).toBe(expected);
    // Mensajes propios como salientes con tildes; respuestas enlazadas; nota de voz y documento.
    const lucia = rows.find((c) => c.kind === 'dm' && c.unread === 0)!;
    const msgs = await listMessages(user.id, lucia.id);
    expect(msgs.some((m) => m.direction === 'out' && (m.status === 'read' || m.status === 'delivered'))).toBe(true);
    expect(msgs.at(-1)?.replyToId).toBeTruthy();
    const all = (await getDb().prepare("SELECT media_type, meta FROM groups_messages WHERE number_id = ? AND media_type != ''").all(row.id)) as Array<{ media_type: string; meta: string }>;
    expect(all.some((m) => m.media_type.startsWith('audio/') && JSON.parse(m.meta).media?.kind === 'voice')).toBe(true);
    expect(all.some((m) => m.media_type === 'application/pdf')).toBe(true);
    const gm = await listMessages(user.id, group.id);
    expect(gm.some((m) => m.reactions.some((r) => r.emoji === '❤️'))).toBe(true);
    // Nada creó tickets (palabras clave, reacciones) ni quedó asignado por reglas.
    const tickets = (await getDb().prepare('SELECT COUNT(*) AS n FROM groups_tickets WHERE user_id = ?').get(user.id)) as { n: number };
    expect(Number(tickets.n)).toBe(0);

    // Reimportar no duplica.
    await queueImport(row, { restart: true });
    await runToEnd(row.id);
    const again = (await getDb().prepare('SELECT COUNT(*) AS n FROM groups_messages WHERE number_id = ?').get(row.id)) as { n: number };
    expect(Number(again.n)).toBe(expected);
    expect(calls.some((p) => p.startsWith('/chat/findChats/'))).toBe(true);
  }, 120_000);

  it('una tanda corta deja el avance guardado y el cron la retoma; dos corridas a la vez no se pisan', async () => {
    stubEvolution(buildEvolutionData({ chats: 40, groups: 2 }));
    const { row } = await connectedNumber('imp-chunks');
    await queueImport(row);
    const first = await runImportChunk(row.id, { budgetMs: 1 });
    expect(first?.status).toBe('running');
    // Mientras la fila está reclamada, otra corrida no hace nada.
    await getDb().prepare('UPDATE groups_imports SET claimed_until = ? WHERE number_id = ?').run(new Date(Date.now() + 60_000).toISOString(), row.id);
    expect(await runImportChunk(row.id, { budgetMs: 1000 })).toBeNull();
    await getDb().prepare('UPDATE groups_imports SET claimed_until = NULL WHERE number_id = ?').run(row.id);
    for (let i = 0; i < 200; i++) {
      await runImports({ budgetMs: 30_000 });
      if ((await getImportStatus(row.user_id, row.id))?.status === 'done') break;
    }
    const st = await getImportStatus(row.user_id, row.id);
    expect(st).toMatchObject({ status: 'done', chatsTotal: 42, chatsDone: 42 });
  }, 120_000);

  it('el historial que llega por webhook (messages.set) no deja chats esperando ni marcados', async () => {
    stubEvolution();
    const { user, row } = await connectedNumber('imp-set');
    const r = await ingestEvents(
      row,
      parseEvolutionWebhook({ event: 'messages.set', data: [{ key: { id: 'S1', fromMe: false, remoteJid: '5491100003333@s.whatsapp.net' }, pushName: 'Nora', message: { conversation: '¿siguen abiertos?' }, messageTimestamp: 1700000000 }] }),
      { history: true },
    );
    expect(r.messages).toBe(1);
    const { rows } = await listChats(user.id, user.id);
    expect(rows[0]).toMatchObject({ name: 'Nora', unread: 0, awaitingSince: null, flagged: false });
  });

  it('no cruza workspaces: la importación de un número solo escribe en el suyo', async () => {
    stubEvolution(buildEvolutionData({ chats: 5, groups: 1 }));
    const a = await connectedNumber('imp-ws-a');
    const b = await connectedNumber('imp-ws-b');
    await queueImport(a.row);
    await runToEnd(a.row.id);
    expect((await listChats(a.user.id, a.user.id)).total).toBe(6);
    expect((await listChats(b.user.id, b.user.id)).total).toBe(0);
    expect(await getImportStatus(b.user.id, a.row.id)).toBeNull();
  });
});
