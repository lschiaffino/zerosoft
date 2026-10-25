import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam, removeMember as removeTeamMember } from '@/lib/teams';
import {
  afterPost,
  createChannel,
  deleteMessage,
  editMessage,
  inviteMembers,
  listMyChannels,
  openDm,
  postMessage,
  removeMember,
  talkDeliveryAllowed,
  updateChannel,
  type TalkActor,
} from '@/lib/talk';
import { createHook, createReminder, deleteHook, heartbeat, searchMessages } from '@/lib/talk-extras';
import { fireTalkReminders, notifyForMessage, sendTalkEmails } from '@/lib/talk-notify';
import { postAsBot } from '@/lib/talk-bot';
import { connectionFilter, talkStream, visibleChannels } from '@/lib/talk-realtime';
import { createWebhook, retryDueWebhooks } from '@/lib/webhooks';
import { createFlow, updateFlow } from '@/lib/flow';
import { schedulePresets, remindPresets } from '@/lib/talk-time';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
});

async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const bob = await makeUser(`${label}-bob`);
  const team = await createTeam(owner.id, `${label} team`);
  await addMember(team.id, ana.id);
  await addMember(team.id, bob.id);
  const actor = (id: string, role: TalkActor['role'] = 'member'): TalkActor => ({ workspaceId: owner.id, personId: id, role, teamId: team.id });
  return { owner, ana, bob, team, o: actor(owner.id, 'owner'), a: actor(ana.id), b: actor(bob.id) };
}

const deliveries = async (hookId: string) =>
  Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM webhook_deliveries WHERE webhook_id = ?').get(hookId)) as { n: number }).n);

const notes = async (userId: string, sourceId: string) =>
  (await getDb().prepare("SELECT id, body FROM notifications WHERE user_id = ? AND source_id = ?").all(userId, sourceId)) as Array<{ id: string; body: string }>;

async function eventFlow(ws: string, creator: string) {
  const res = await createFlow(ws, creator, {
    name: 'talk',
    graph: { nodes: [{ id: 't', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event: 'talk.message.posted' } }], edges: [] },
  });
  if (!res.ok) throw new Error(res.error);
  await updateFlow(ws, res.flow.id, { enabled: true });
  return res.flow.id;
}

const runs = async (flowId: string) => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM flow_runs WHERE flow_id = ?').get(flowId)) as { n: number }).n);

describe('B1: webhooks salientes y Flow con canales privados', () => {
  it('un privado solo sale por webhooks y flows de miembros; los DMs nunca', async () => {
    const w = await workspace('b1');
    const priv = await createChannel(w.a, { name: 'secreto', kind: 'private' });
    const pub = await createChannel(w.a, { name: 'abierto', kind: 'public' });
    const anaHook = await createWebhook(w.owner.id, { url: 'http://127.0.0.1:9/a', events: ['talk.message.posted'], createdBy: w.ana.id });
    const bobHook = await createWebhook(w.owner.id, { url: 'http://127.0.0.1:9/b', events: ['talk.message.posted'], createdBy: w.bob.id });
    const anaFlow = await eventFlow(w.owner.id, w.ana.id);
    const bobFlow = await eventFlow(w.owner.id, w.bob.id);

    await afterPost(w.a, await postMessage(w.a, { channelId: priv.id, body: 'plan secreto' }));
    expect(await deliveries(anaHook.id)).toBe(1);
    expect(await deliveries(bobHook.id)).toBe(0);
    expect(await runs(anaFlow)).toBe(1);
    expect(await runs(bobFlow)).toBe(0);

    await afterPost(w.a, await postMessage(w.a, { channelId: pub.id, body: 'para todos' }));
    expect(await deliveries(bobHook.id)).toBe(1);
    expect(await runs(bobFlow)).toBe(1);

    const dm = await openDm(w.a, [w.bob.id]);
    await afterPost(w.a, await postMessage(w.a, { channelId: dm.id, body: 'entre nos' }));
    // Igual que después del público (2 y 1): el DM no sumó nada.
    expect(await deliveries(anaHook.id)).toBe(2);
    expect(await deliveries(bobHook.id)).toBe(1);
  });

  it('la acción de Flow y el webhook entrante publican solo donde su dueño es miembro', async () => {
    const w = await workspace('b1b');
    const priv = await createChannel(w.a, { name: 'solo-ana', kind: 'private' });
    await expect(postAsBot(w.owner.id, { channel: priv.id, body: 'x', botName: 'Flow', memberId: w.bob.id })).rejects.toMatchObject({ code: 'not_member' });
    const ok = await postAsBot(w.owner.id, { channel: 'solo-ana', body: 'hola', botName: 'Flow', memberId: w.ana.id });
    expect(ok.botName).toBe('Flow');
    // Webhook entrante de Ana: si Ana sale del privado, deja de publicar.
    await inviteMembers(w.a, priv.id, [w.bob.id]);
    await createHook(w.a, priv.id, 'CI');
    await removeMember(w.a, priv.id, w.ana.id);
    await expect(postAsBot(w.owner.id, { channel: priv.id, body: 'x', botName: 'CI', memberId: w.ana.id })).rejects.toMatchObject({ code: 'not_member' });
  });

  it('el texto del webhook usa nombres, no ids', async () => {
    const w = await workspace('b1c');
    const pub = await createChannel(w.a, { name: 'names', kind: 'public' });
    const hook = await createWebhook(w.owner.id, { url: 'http://127.0.0.1:9/n', events: ['talk.message.posted'], createdBy: w.ana.id });
    await afterPost(w.a, await postMessage(w.a, { channelId: pub.id, body: `hola <@${w.bob.id}>` }));
    const row = (await getDb().prepare('SELECT payload FROM webhook_deliveries WHERE webhook_id = ?').get(hook.id)) as { payload: string };
    expect(JSON.parse(row.payload).data.text).toBe(`hola @${w.bob.name}`);
  });
});

describe('B2: quien sale del workspace', () => {
  it('no recibe avisos ni emails, sus DMs quedan desactivados y se limpia la cola', async () => {
    const w = await workspace('b2');
    const dm = await openDm(w.a, [w.bob.id]);
    const first = await postMessage(w.a, { channelId: dm.id, body: 'antes' });
    await notifyForMessage(w.a, first.row, first.channel);
    expect(await notes(w.bob.id, first.row.id)).toHaveLength(1);
    const queued = Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM talk_email_queue WHERE user_id = ? AND sent_at IS NULL').get(w.bob.id)) as { n: number }).n);
    expect(queued).toBe(1);

    await removeTeamMember(w.team.id, w.bob.id);
    // Avisos y emails pendientes de Talk: fuera.
    expect(await notes(w.bob.id, first.row.id)).toHaveLength(0);
    expect(Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM talk_email_queue WHERE user_id = ?').get(w.bob.id)) as { n: number }).n)).toBe(0);
    // El DM sigue en el sidebar de Ana, desactivado: se lee y no se escribe.
    const anaDm = (await listMyChannels(w.a)).find((c) => c.id === dm.id)!;
    expect(anaDm.deactivated).toBe(true);
    await expect(postMessage(w.a, { channelId: dm.id, body: 'después' })).rejects.toMatchObject({ code: 'dm_deactivated' });
    // Un grupo con Bob sigue andando, pero a Bob no le llega nada.
    const carol = await makeUser('b2-carol');
    await addMember(w.team.id, carol.id);
    await addMember(w.team.id, w.bob.id);
    const group = await openDm(w.a, [w.bob.id, carol.id]);
    await removeTeamMember(w.team.id, w.bob.id);
    const r = await postMessage(w.a, { channelId: group.id, body: 'grupo' });
    expect(await notifyForMessage(w.a, r.row, r.channel)).toBe(1);
    expect(await notes(w.bob.id, r.row.id)).toHaveLength(0);
  });

  it('los emails en cola revisan el acceso al salir', async () => {
    const w = await workspace('b2e');
    const priv = await createChannel(w.a, { name: 'priv-mail', kind: 'private', memberIds: [w.bob.id] });
    const r = await postMessage(w.a, { channelId: priv.id, body: `ojo <@${w.bob.id}>` });
    await notifyForMessage(w.a, r.row, r.channel);
    // Bob sale del privado: el aviso con el texto se borra y el email no sale.
    await removeMember(w.b, priv.id, w.bob.id);
    expect(await notes(w.bob.id, r.row.id)).toHaveLength(0);
    expect(Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM talk_email_queue WHERE user_id = ?').get(w.bob.id)) as { n: number }).n)).toBe(0);
    // Un email que quedara en cola de antes se revisa al mandarlo: no sale si ya no lee el canal.
    const nid = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO notifications (id, user_id, type, title, body, href, source_type, source_id, meta, created_at) VALUES (?, ?, 'talk_mention', 't', 'texto privado', '/x', 'talk_message', ?, ?, ?)")
      .run(nid, w.bob.id, r.row.id, JSON.stringify({ channelId: priv.id, messageAt: r.row.created_at }), new Date().toISOString());
    await getDb().prepare('INSERT INTO talk_email_queue (notification_id, user_id, due_at) VALUES (?, ?, ?)').run(nid, w.bob.id, new Date(Date.now() - 1000).toISOString());
    const before = (await sendTalkEmails({ now: new Date() })).skipped;
    expect(before).toBeGreaterThanOrEqual(1);
    expect(((await getDb().prepare('SELECT sent_at FROM talk_email_queue WHERE notification_id = ?').get(nid)) as { sent_at: string | null }).sent_at).not.toBeNull();
  });
});

describe('A1/A2: recordatorios, borrar y editar', () => {
  it('un recordatorio de un canal que ya no leo no dispara', async () => {
    const w = await workspace('a1');
    const priv = await createChannel(w.a, { name: 'a1-priv', kind: 'private', memberIds: [w.bob.id] });
    const r = await postMessage(w.a, { channelId: priv.id, body: 'texto privado' });
    await createReminder(w.b, { messageId: r.row.id, remindAt: new Date(Date.now() + 60_000).toISOString() });
    // Sale y se limpian sus recordatorios de ahí; uno hecho a mano en la base tampoco dispara.
    await removeMember(w.b, priv.id, w.bob.id);
    await getDb()
      .prepare('INSERT INTO talk_reminders (id, workspace_id, user_id, message_id, text, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), w.owner.id, w.bob.id, r.row.id, '', new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
    await fireTalkReminders({ now: new Date(Date.now() + 120_000) });
    const reminders = (await getDb().prepare("SELECT body FROM notifications WHERE user_id = ? AND type = 'talk_reminder'").all(w.bob.id)) as Array<{ body: string }>;
    expect(reminders).toHaveLength(0);
  });

  it('borrar un mensaje borra sus avisos y emails; editarlo actualiza el aviso', async () => {
    const w = await workspace('a2');
    const c = await createChannel(w.a, { name: 'a2', kind: 'public', memberIds: [w.bob.id] });
    const r = await postMessage(w.a, { channelId: c.id, body: `hola <@${w.bob.id}>` });
    await notifyForMessage(w.a, r.row, r.channel);
    await editMessage(w.a, r.row.id, `chau <@${w.bob.id}>`);
    expect((await notes(w.bob.id, r.row.id))[0].body).toBe(`chau @${w.bob.name}`);
    await deleteMessage(w.a, r.row.id);
    expect(await notes(w.bob.id, r.row.id)).toHaveLength(0);
    expect(Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM talk_email_queue WHERE user_id = ?').get(w.bob.id)) as { n: number }).n)).toBe(0);
  });
});

describe('M4: webhooks entrantes', () => {
  it('solo quien lo creó o un admin del canal lo borra', async () => {
    const w = await workspace('m4');
    const c = await createChannel(w.a, { name: 'm4', kind: 'public', memberIds: [w.bob.id] });
    const { hook } = await createHook(w.b, c.id, 'Bob CI');
    const other = await createHook(w.a, c.id, 'Ana CI');
    // Bob no administra el canal: no borra el de Ana.
    await expect(deleteHook(w.b, c.id, other.hook.id)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await deleteHook(w.b, c.id, hook.id)).toBe(true);
    // Ana creó el canal: puede borrar cualquiera.
    expect(await deleteHook(w.a, c.id, other.hook.id)).toBe(true);
  });
});

describe('tiempo real: filtro por conexión', () => {
  it('cada conexión ve solo lo suyo y el acceso se refresca con eventos de canal', async () => {
    const w = await workspace('rt');
    const priv = await createChannel(w.a, { name: 'rt-priv', kind: 'private' });
    expect((await visibleChannels(w.b)).has(priv.id)).toBe(false);
    const filter = connectionFilter(w.b);
    const base = { workspaceId: w.owner.id, userId: null, actorId: w.ana.id, payload: {}, at: new Date().toISOString() };
    expect(await filter([{ ...base, id: 1, kind: 'message', channelId: priv.id }])).toHaveLength(0);
    await inviteMembers(w.a, priv.id, [w.bob.id]);
    // El evento de canal refresca el acceso antes de filtrar el lote.
    const out = await filter([
      { ...base, id: 2, kind: 'channel', channelId: priv.id },
      { ...base, id: 3, kind: 'message', channelId: priv.id },
    ]);
    expect(out.map((e) => e.id)).toEqual([2, 3]);
    // Otro workspace o eventos personales de otra persona: nunca.
    expect(await filter([{ ...base, id: 4, kind: 'message', channelId: priv.id, workspaceId: 'otro' }])).toHaveLength(0);
    expect(await filter([{ ...base, id: 5, kind: 'read', channelId: null, userId: w.ana.id }])).toHaveLength(0);
  });
});

describe('N1: quien sale del workspace con el tiempo real abierto', () => {
  it('la conexión deja de recibir y se corta al llegar el evento de acceso; el latido no lo revive', async () => {
    const w = await workspace('n1');
    const general = await createChannel(w.a, { name: 'n1-todos', kind: 'public', memberIds: [w.bob.id] });
    let revoked = 0;
    const filter = connectionFilter(w.b, () => revoked++);
    const base = { workspaceId: w.owner.id, actorId: w.ana.id, at: new Date().toISOString() };
    expect(await filter([{ ...base, id: 1, kind: 'message', channelId: general.id, userId: null, payload: {} }])).toHaveLength(1);
    await removeTeamMember(w.team.id, w.bob.id);
    const ev = (await getDb().prepare("SELECT * FROM talk_events WHERE kind = 'access' AND user_id = ? ORDER BY id DESC LIMIT 1").get(w.bob.id)) as { id: number } | undefined;
    expect(ev).toBeTruthy();
    const out = await filter([
      { ...base, id: 2, kind: 'access', channelId: null, userId: w.bob.id, payload: { change: 'removed' } },
      { ...base, id: 3, kind: 'message', channelId: general.id, userId: null, payload: { message: { body: 'secreto' } } },
    ]);
    expect(out).toHaveLength(0);
    expect(revoked).toBe(1);
    // Y nada más pasa por esa conexión.
    expect(await filter([{ ...base, id: 4, kind: 'message', channelId: general.id, userId: null, payload: {} }])).toHaveLength(0);
    expect((await visibleChannels(w.b)).size).toBe(0);
    // El latido de una conexión vieja no vuelve a escribir presencia.
    await heartbeat(w.b, { force: true });
    expect(await getDb().prepare('SELECT 1 AS x FROM talk_presence WHERE workspace_id = ? AND user_id = ?').get(w.owner.id, w.bob.id)).toBeUndefined();
  });

  it('el stream SSE manda bye revoked y corta', async () => {
    const w = await workspace('n1s');
    await createChannel(w.a, { name: 'n1s', kind: 'public', memberIds: [w.bob.id] });
    const res = talkStream(w.b, 0);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    // Una sola lectura pendiente a la vez (si no, un chunk se pierde en una promesa abandonada).
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
    let done = false;
    const read = async (until: (t: string) => boolean, ms = 8000) => {
      const end = Date.now() + ms;
      while (!until(text) && !done && Date.now() < end) {
        pending ??= reader.read();
        const r = await Promise.race([pending, new Promise<null>((ok) => setTimeout(() => ok(null), 300))]);
        if (!r) continue;
        pending = null;
        if (r.value) text += dec.decode(r.value);
        if (r.done) done = true;
      }
    };
    await read((t) => t.includes('event: ready'));
    expect(text).toMatch(/event: ready\ndata: \{"cursor":\d+\}/);
    await removeTeamMember(w.team.id, w.bob.id);
    await read((t) => t.includes('"reason":"revoked"'));
    expect(text).toContain('event: bye\ndata: {"reason":"revoked"}');
    await reader.cancel().catch(() => undefined);
  }, 20_000);

  it('al volver al workspace vuelve a #general', async () => {
    const w = await workspace('b6');
    const { ensureGeneral } = await import('@/lib/talk');
    await ensureGeneral(w.o);
    await ensureGeneral(w.b);
    await removeTeamMember(w.team.id, w.bob.id);
    expect((await listMyChannels(w.b)).length).toBe(0);
    await addMember(w.team.id, w.bob.id);
    await ensureGeneral(w.b);
    expect((await listMyChannels(w.b)).map((c) => c.name)).toContain('general');
  });
});

describe('B3/B4: reintentos y público que pasa a privado', () => {
  it('un reintento revalida la audiencia; pasar a privado limpia lo de los que no son miembros', async () => {
    const w = await workspace('b3');
    const c = await createChannel(w.a, { name: 'b3', kind: 'public', memberIds: [w.bob.id] });
    const bobHook = await createWebhook(w.owner.id, { url: 'http://127.0.0.1:9/b3', events: ['talk.message.posted'], createdBy: w.bob.id });
    const r = await postMessage(w.a, { channelId: c.id, body: `hola <@${w.bob.id}>` });
    await afterPost(w.a, r);
    await notifyForMessage(w.a, r.row, r.channel);
    expect(await talkDeliveryAllowed(w.owner.id, w.bob.id, { channel: { id: c.id } })).toBe(true);
    // Bob sale y el canal pasa a privado: la entrega pendiente ya no va y sus avisos se borran.
    await removeMember(w.b, c.id, w.bob.id);
    await updateChannel(w.a, c.id, { kind: 'private' });
    expect(await talkDeliveryAllowed(w.owner.id, w.bob.id, { channel: { id: c.id } })).toBe(false);
    expect(await notes(w.bob.id, r.row.id)).toHaveLength(0);
    await getDb().prepare("UPDATE webhook_deliveries SET status = 'pending', attempts = 1, next_attempt_at = ?, claimed_until = NULL WHERE webhook_id = ?").run(new Date(Date.now() - 1000).toISOString(), bobHook.id);
    await retryDueWebhooks(100);
    const d = (await getDb().prepare('SELECT status, last_error FROM webhook_deliveries WHERE webhook_id = ?').get(bobHook.id)) as { status: string; last_error: string };
    expect(d).toEqual({ status: 'failed', last_error: 'audience_revoked' });
  });

  it('B5: comillas solas o vacío no buscan nada', async () => {
    const w = await workspace('b5');
    const c = await createChannel(w.a, { name: 'b5', kind: 'public' });
    await postMessage(w.a, { channelId: c.id, body: 'dijo "hola"' });
    expect((await searchMessages(w.a, '""')).results).toHaveLength(0);
    expect((await searchMessages(w.a, '"  "')).results).toHaveLength(0);
    expect((await searchMessages(w.a, '   ')).results).toHaveLength(0);
    expect((await searchMessages(w.a, 'hola')).results).toHaveLength(1);
  });
});

describe('presets de tiempo', () => {
  it('un domingo los presets no se repiten', () => {
    const sunday = new Date(2026, 9, 25, 10, 0, 0); // domingo 25/10/2026
    expect(sunday.getDay()).toBe(0);
    const [tomorrow, monday] = schedulePresets(sunday);
    expect(tomorrow.at.getTime()).not.toBe(monday.at.getTime());
    const times = remindPresets(sunday).map((p) => p.at.getTime());
    expect(new Set(times).size).toBe(times.length);
  });
});
