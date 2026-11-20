import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupAddressing, waMentionPayload } from '@/lib/wa-mention-jids';
import { applyWaMentionPicks, cleanWaMentionPicks, serializeWaMentions, waMentionables, waMentionPicks } from '@/lib/wa-compose-mentions';
import { type FetchLike } from '@/lib/groups-provider';
import { evolutionProvider, mentionGroupOf } from '@/lib/groups-provider-bridge';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, sendMessage } from '@/lib/groups';
import { createBroadcast, processBroadcasts } from '@/lib/groups-broadcasts';
import { getDb } from '@/lib/db';
import { upsertThread, listScheduled } from '@/lib/inbox/core';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { createBatch } from '@/lib/inbox/schedule';
import { sendDueScheduled } from '@/lib/inbox/send';
import { sendWaMessage } from '@/lib/inbox/wa-actions';
import { makeUser } from './helpers';

/**
 * Menciones de WhatsApp al salir: lo programado sale igual que lo mandado en
 * el momento, y en un grupo por lid la mención va por lid (texto y lista).
 * Números y lids inventados.
 */

const ANA = { phone: '5491100000001', lid: '100000000000001', name: 'Ana Prueba' };
const BETO = { phone: '5491100000002', lid: '100000000000002', name: 'Beto Prueba' };
const people = waMentionables([ANA, BETO].map((p) => ({ phone: p.phone, name: p.name })));
const typed = `cómo estás @${ANA.name} ?`;

describe('waMentionPayload', () => {
  it('grupo por teléfono: "@<teléfono>" y el JID completo (sin que Evolution le saque el 9)', () => {
    const group = { addressing: 'pn' as const, members: [ANA, BETO] };
    expect(waMentionPayload(`hola @${ANA.phone} y @${BETO.phone}`, [ANA.phone, BETO.phone], group)).toEqual({
      text: `hola @${ANA.phone} y @${BETO.phone}`,
      mentioned: [`${ANA.phone}@s.whatsapp.net`, `${BETO.phone}@s.whatsapp.net`],
    });
    // Sin saber cómo es el grupo: por teléfono.
    expect(waMentionPayload(`hola @${ANA.phone}`, [ANA.phone], null)).toEqual({ text: `hola @${ANA.phone}`, mentioned: [`${ANA.phone}@s.whatsapp.net`] });
  });

  it('grupo por lid: el texto y la lista nombran el lid de cada persona', () => {
    const group = { addressing: 'lid' as const, members: [ANA, BETO] };
    const out = waMentionPayload(`hola @${ANA.phone}, @${BETO.phone} y @${ANA.phone}`, [ANA.phone, BETO.phone], group);
    expect(out).toEqual({ text: `hola @${ANA.lid}, @${BETO.lid} y @${ANA.lid}`, mentioned: [`${ANA.lid}@lid`, `${BETO.lid}@lid`] });
    // Cada token del texto es exactamente el usuario de un JID de la lista.
    const tokens = [...out.text.matchAll(/@(\d+)/g)].map((m) => m[1]);
    expect(new Set(tokens)).toEqual(new Set(out.mentioned.map((j) => j.replace(/@.*/, ''))));
  });

  it('un lid sin teléfono conocido va por lid; uno con teléfono en un grupo por teléfono, por teléfono', () => {
    expect(waMentionPayload(`ey @${ANA.lid}`, [`${ANA.lid}@lid`], { addressing: 'pn', members: [] })).toEqual({ text: `ey @${ANA.lid}`, mentioned: [`${ANA.lid}@lid`] });
    expect(waMentionPayload(`ey @${ANA.lid}`, [`${ANA.lid}@lid`], { addressing: 'pn', members: [ANA] })).toEqual({ text: `ey @${ANA.phone}`, mentioned: [`${ANA.phone}@s.whatsapp.net`] });
    // En un grupo por lid, una persona sin lid conocido queda por teléfono (mejor que nada).
    expect(waMentionPayload(`ey @${BETO.phone}`, [BETO.phone], { addressing: 'lid', members: [{ phone: BETO.phone }] }).mentioned).toEqual([`${BETO.phone}@s.whatsapp.net`]);
    // Un número que es el comienzo de otro no se reemplaza a medias.
    expect(waMentionPayload(`@${ANA.phone}9 @${ANA.phone}`, [ANA.phone], { addressing: 'lid', members: [ANA] }).text).toBe(`@${ANA.phone}9 @${ANA.lid}`);
  });

  it('cómo direcciona el grupo, según los ids de los participantes (Baileys)', () => {
    expect(groupAddressing([`${ANA.lid}@lid`, `${BETO.lid}@lid`, `${BETO.phone}@s.whatsapp.net`])).toBe('lid');
    expect(groupAddressing([`${ANA.phone}@s.whatsapp.net`, undefined, 3])).toBe('pn');
    expect(mentionGroupOf({ participants: [{ id: `${ANA.lid}@lid`, phoneNumber: `${ANA.phone}@s.whatsapp.net`, admin: null }, { id: `${BETO.lid}@lid` }] })).toEqual({
      addressing: 'lid',
      members: [
        { phone: ANA.phone, lid: ANA.lid },
        { phone: '', lid: BETO.lid },
      ],
    });
    expect(mentionGroupOf({ participants: [{ id: `${ANA.phone}@s.whatsapp.net`, lid: `${ANA.lid}@lid` }] })).toEqual({ addressing: 'pn', members: [{ phone: ANA.phone, lid: ANA.lid }] });
    expect(mentionGroupOf({})).toBeNull();
  });
});

describe('menciones de un programado', () => {
  it('se guardan como "@Nombre" → teléfono y salen igual que al mandar en el momento', () => {
    const picks = waMentionPicks(typed, people);
    expect(picks).toEqual([{ phone: ANA.phone, label: ANA.name }]);
    expect(applyWaMentionPicks(typed, JSON.stringify(picks))).toEqual(serializeWaMentions(typed, people));
    // Si al editar se borró la mención, sale como texto común.
    expect(applyWaMentionPicks('cómo estás?', picks)).toEqual({ body: 'cómo estás?', mentions: [] });
    expect(cleanWaMentionPicks([{ phone: 'x', label: 'a' }, { phone: ANA.phone, label: ' Ana \n Prueba ' }, null])).toEqual([{ phone: ANA.phone, label: ANA.name }]);
    expect(cleanWaMentionPicks('no es json')).toEqual([]);
  });
});

function evoFetch(participants: unknown[]) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const out = url.includes('/group/findGroupInfos/') ? { id: 'g', participants } : { key: { id: 'X' } };
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls, sends: () => calls.filter((c) => c.url.includes('/message/sendText/')).map((c) => c.body) };
}

describe('Evolution: lo que recibe el servidor de WhatsApp', () => {
  const cfg = { baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'mention-test' };
  const lidParts = [
    { id: `${ANA.lid}@lid`, phoneNumber: `${ANA.phone}@s.whatsapp.net` },
    { id: `${BETO.lid}@lid`, phoneNumber: `${BETO.phone}@s.whatsapp.net` },
  ];
  const pnParts = [
    { id: `${ANA.phone}@s.whatsapp.net`, lid: `${ANA.lid}@lid` },
    { id: `${BETO.phone}@s.whatsapp.net`, lid: `${BETO.lid}@lid` },
  ];

  it('en el momento y programado: el mismo pedido, por lid en un grupo por lid', async () => {
    const evo = evoFetch(lidParts);
    const p = evolutionProvider(cfg, { fetch: evo.f });
    const now = serializeWaMentions(typed, people);
    await p.sendText('120363100000000001@g.us', now.body, { mentions: now.mentions });
    const later = applyWaMentionPicks(typed, JSON.stringify(waMentionPicks(typed, people)));
    await p.sendText('120363100000000001@g.us', later.body, { mentions: later.mentions });
    const [a, b] = evo.sends();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ number: '120363100000000001@g.us', text: `cómo estás @${ANA.lid} ?`, mentioned: [`${ANA.lid}@lid`] });
    // El grupo se pregunta una vez (queda en memoria unos minutos).
    expect(evo.calls.filter((c) => c.url.includes('/group/findGroupInfos/'))).toHaveLength(1);
  });

  it('grupo por teléfono: "@<teléfono>" y el JID completo', async () => {
    const evo = evoFetch(pnParts);
    const p = evolutionProvider(cfg, { fetch: evo.f });
    const out = serializeWaMentions(typed, people);
    await p.sendText('120363100000000002@g.us', out.body, { mentions: out.mentions });
    expect(evo.sends()[0]).toMatchObject({ text: `cómo estás @${ANA.phone} ?`, mentioned: [`${ANA.phone}@s.whatsapp.net`] });
  });

  it('sin menciones no pregunta por el grupo; en un chat 1 a 1 tampoco', async () => {
    const evo = evoFetch(lidParts);
    const p = evolutionProvider(cfg, { fetch: evo.f });
    await p.sendText('120363100000000003@g.us', 'hola', {});
    await p.sendText(`${ANA.phone}@s.whatsapp.net`, `hola @${BETO.phone}`, { mentions: [BETO.phone] });
    expect(evo.calls.filter((c) => c.url.includes('/group/findGroupInfos/'))).toHaveLength(0);
    expect(evo.sends()[0]).not.toHaveProperty('mentioned');
  });
});

type FakeStore = Map<string, { connectedAt: number | null; groups: Map<string, { participants: Array<{ phone: string; role: string }>; lids?: string[]; addressing?: 'pn' | 'lid' }>; directory?: Map<string, { phone?: string; lid?: string; name?: string }> }>;
const fakeStore = () => (globalThis as unknown as { __groupsFake: FakeStore }).__groupsFake;

/** El grupo falso con Ana y Beto (teléfono y lid conocidos), por teléfono o por lid. */
function shapeFakeGroup(numberId: string, gid: string, addressing: 'pn' | 'lid') {
  const s = fakeStore().get(numberId)!;
  s.directory ??= new Map();
  for (const p of [ANA, BETO]) s.directory.set(p.phone, { phone: p.phone, lid: p.lid, name: p.name });
  const g = s.groups.get(gid) ?? { participants: [{ phone: '15550000001', role: 'superadmin' }] };
  for (const p of [ANA, BETO]) if (!g.participants.some((x) => x.phone === p.phone)) g.participants.push({ phone: p.phone, role: 'member' });
  g.addressing = addressing;
  s.groups.set(gid, g as never);
}

describe('Lines: un programado con mención sale como el mandado en el momento', () => {
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });

  for (const addressing of ['pn', 'lid'] as const) {
    it(`grupo por ${addressing === 'lid' ? 'lid' : 'teléfono'}`, async () => {
      const user = await makeUser(`wa-mention-later-${addressing}`);
      const n = await createNumber(user.id, user.id, { provider: 'fake' });
      await connectNumber(user.id, n.id);
      const st = fakeStore().get(n.id);
      if (st) st.connectedAt = Date.now() - 5000;
      const row = (await getNumberRowById(n.id))!;
      const gid = addressing === 'lid' ? '120363100000000011@g.us' : '120363100000000012@g.us';
      await ingestEvents(row, [{ type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: ANA.phone, senderName: ANA.name, providerMessageId: `G-${addressing}`, body: 'hola' }]);
      shapeFakeGroup(n.id, gid, addressing);
      const chat = (await listChats(user.id, user.id)).rows.find((c) => c.kind === 'group')!;

      const now = serializeWaMentions(typed, people);
      await sendMessage(user.id, user.id, chat.id, { body: now.body, mentions: now.mentions });
      const b = await createBroadcast(user.id, user.id, { body: typed, chatIds: [chat.id], kind: 'scheduled', scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), mentions: waMentionPicks(typed, people) });
      expect(String(((await getDb().prepare('SELECT mentions FROM groups_broadcasts WHERE id = ?').get(b.id)) as { mentions: string }).mentions)).toContain(ANA.phone);
      await processBroadcasts({ now: new Date(Date.now() + 3_700_000), broadcastId: b.id, gapMs: 0 });

      const texts = fakeSent(n.id).filter((m) => m.kind === 'text' && m.chatId === gid);
      expect(texts).toHaveLength(2);
      const [first, second] = texts.map(({ text, mentions, mentioned, mentionText }) => ({ text, mentions, mentioned, mentionText }));
      expect(second).toEqual(first);
      const id = addressing === 'lid' ? ANA.lid : ANA.phone;
      expect(first).toMatchObject({ text: `cómo estás @${ANA.phone} ?`, mentions: [ANA.phone], mentionText: `cómo estás @${id} ?`, mentioned: [addressing === 'lid' ? `${ANA.lid}@lid` : `${ANA.phone}@s.whatsapp.net`] });
      // En zerosoft el programado quedó guardado con la mención (el hilo muestra "@Ana Prueba").
      const saved = (await getDb().prepare("SELECT body, meta FROM groups_messages WHERE chat_id = ? AND direction = 'out' ORDER BY created_at").all(chat.id)) as Array<{ body: string; meta: string }>;
      expect(saved.map((m) => m.body)).toEqual([now.body, now.body]);
      expect(saved.every((m) => JSON.parse(m.meta).mentions?.[0] === ANA.phone)).toBe(true);
    });
  }

  it('un envío masivo no lleva menciones (cada grupo tiene otra gente)', async () => {
    const user = await makeUser('wa-mention-broadcast');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [
      { type: 'message', chatId: '120363100000000013@g.us', isGroup: true, fromMe: false, senderPhone: ANA.phone, senderName: ANA.name, providerMessageId: 'G-b1', body: 'hola' },
      { type: 'message', chatId: '120363100000000014@g.us', isGroup: true, fromMe: false, senderPhone: ANA.phone, senderName: ANA.name, providerMessageId: 'G-b2', body: 'hola' },
    ]);
    const chats = (await listChats(user.id, user.id)).rows.filter((c) => c.kind === 'group');
    const b = await createBroadcast(user.id, user.id, { body: typed, chatIds: chats.map((c) => c.id), mentions: waMentionPicks(typed, people) });
    expect(((await getDb().prepare('SELECT mentions FROM groups_broadcasts WHERE id = ?').get(b.id)) as { mentions: string }).mentions).toBe('');
  });
});

describe('Inbox: un programado con mención sale como el mandado en el momento', () => {
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('INBOX_FAKE', '1');
    resetFakeProvider();
  });

  for (const addressing of ['pn', 'lid'] as const) {
    it(`grupo por ${addressing === 'lid' ? 'lid' : 'teléfono'}`, async () => {
      const owner = (await makeUser(`inbox-mention-later-${addressing}`)).id;
      const { account } = await connectWhatsapp(owner);
      await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
      await new Promise((r) => setTimeout(r, 1600));
      const gid = addressing === 'lid' ? '120363100000000021@g.us' : '120363100000000022@g.us';
      const thread = await upsertThread(account, { externalId: gid, kind: 'group', title: 'Grupo de prueba' });
      shapeFakeGroup(`inbox-${account.id}`, gid, addressing);

      const now = serializeWaMentions(typed, people);
      await sendWaMessage(owner, thread.id, now.body, { mentions: now.mentions });
      const t0 = new Date();
      await createBatch(owner, { threadId: thread.id, sendAt: new Date(t0.getTime() + 120_000).toISOString(), parts: [{ body: typed, mentions: waMentionPicks(typed, people) }], key: `k-mention-${addressing}-1` }, t0);
      const listed = await listScheduled(owner, thread.id);
      expect(listed[0]).toMatchObject({ body: typed, mentions: [{ phone: ANA.phone, label: ANA.name }] });
      await sendDueScheduled(new Date(t0.getTime() + 121_000));

      const texts = fakeSent(`inbox-${account.id}`).filter((m) => m.kind === 'text' && m.chatId === gid);
      expect(texts).toHaveLength(2);
      const [first, second] = texts.map(({ text, mentions, mentioned, mentionText }) => ({ text, mentions, mentioned, mentionText }));
      expect(second).toEqual(first);
      expect(first).toMatchObject({ text: now.body, mentioned: [addressing === 'lid' ? `${ANA.lid}@lid` : `${ANA.phone}@s.whatsapp.net`] });
    });
  }
});
