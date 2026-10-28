import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam, removeMember as removeTeamMember } from '@/lib/teams';
import {
  browseChannels,
  createChannel,
  inviteMembers,
  listEventsSince,
  openDm,
  postMessage,
  readableChannel,
  removeMember,
  type TalkActor,
} from '@/lib/talk';
import { searchMessages } from '@/lib/talk-extras';
import { notifyForMessage } from '@/lib/talk-notify';
import { visibleChannels } from '@/lib/talk-realtime';
import { acceptGuestInvite, inviteGuest, removeGuest, resolveTalkActor } from '@/lib/talk-guests';
import { inDndSchedule } from '@/lib/talk-quiet';
import { saveCanvas, getCanvas } from '@/lib/talk-canvas';
import { addItem, cleanData, createList, getList } from '@/lib/talk-lists';
import { createSection, listSections, moveToSection } from '@/lib/talk-sections';
import { HUDDLE_STALE_MS, iceServers, joinHuddle, signalHuddle, sweepHuddles } from '@/lib/talk-huddles';
import { createCommand, parseReply, respondToCommand, runCommand, signBody } from '@/lib/talk-commands';
import { askTalk, summarizeChannel } from '@/lib/talk-ai';
import { applyRetention, exportTalk, setTalkSettings } from '@/lib/talk-admin';
import { talkPush } from '@/lib/talk-push';
import { updateMyProfile, listProfiles } from '@/lib/talk-profile';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('TALK_AI_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
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

/** Invita a una cuenta de afuera como invitada a estos canales (flujo completo con token). */
async function guestOf(w: Awaited<ReturnType<typeof workspace>>, channelIds: string[]) {
  const gina = await makeUser('gina');
  const res = await inviteGuest(w.o, { email: gina.email, channelIds });
  if (res.kind !== 'invited') throw new Error('expected invite');
  const ok = await acceptGuestInvite(res.token, gina);
  expect(ok.ok).toBe(true);
  return { gina, g: { workspaceId: w.owner.id, personId: gina.id, role: 'member', teamId: null, guest: true } as TalkActor };
}

const notes = async (userId: string, sourceId: string) =>
  (await getDb().prepare('SELECT id FROM notifications WHERE user_id = ? AND source_id = ?').all(userId, sourceId)) as Array<{ id: string }>;

describe('invitados', () => {
  it('solo ven sus canales: ni públicos ajenos, ni directorio, ni búsqueda, ni eventos', async () => {
    const w = await workspace('g1');
    const shared = await createChannel(w.a, { name: 'con-cliente', kind: 'public' });
    const other = await createChannel(w.a, { name: 'interno', kind: 'public' });
    await postMessage(w.a, { channelId: other.id, body: 'presupuesto interno secreto' });
    await postMessage(w.a, { channelId: shared.id, body: 'hola cliente presupuesto' });
    const { g } = await guestOf(w, [shared.id]);
    expect(await readableChannel(g, shared.id)).not.toBeNull();
    // Aunque el actor no diga guest, la base manda.
    expect(await readableChannel({ ...g, guest: undefined }, other.id)).toBeNull();
    expect((await browseChannels(g)).map((c) => c.id)).toEqual([shared.id]);
    const found = await searchMessages(g, 'presupuesto');
    expect(found.results.map((r) => r.channel.id)).toEqual([shared.id]);
    const vis = await visibleChannels({ ...g, guest: undefined });
    expect(vis.has(other.id)).toBe(false);
    expect(vis.has(shared.id)).toBe(true);
    const ev = await listEventsSince(g, 0, 500);
    expect(ev.events.some((e) => e.channelId === other.id)).toBe(false);
    await expect(createChannel(g, { name: 'mio', kind: 'public' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('una mención en un público donde no está no le llega; solo un admin lo suma a otros canales', async () => {
    const w = await workspace('g2');
    const shared = await createChannel(w.a, { name: 'externo', kind: 'public' });
    const other = await createChannel(w.a, { name: 'equipo', kind: 'public', memberIds: [w.owner.id] });
    const { gina, g } = await guestOf(w, [shared.id]);
    const r = await postMessage(w.a, { channelId: other.id, body: `ojo <@${gina.id}>` });
    await notifyForMessage(w.a, r.row, r.channel);
    expect(await notes(gina.id, r.row.id)).toHaveLength(0);
    await expect(inviteMembers(w.a, other.id, [gina.id])).rejects.toMatchObject({ code: 'guest_admin_only' });
    await inviteMembers(w.o, other.id, [gina.id]);
    expect(await readableChannel(g, other.id)).not.toBeNull();
    // Un invitado solo abre DMs con gente de sus canales.
    const stranger = await makeUser('stranger');
    await addMember(w.team.id, stranger.id);
    await expect(openDm(g, [stranger.id])).rejects.toMatchObject({ code: 'invalid_member' });
    expect((await openDm(g, [w.ana.id])).kind).toBe('dm');
  });

  it('el link de invitación es de un solo email; sacar al invitado le corta todo al instante', async () => {
    const w = await workspace('g3');
    const ch = await createChannel(w.a, { name: 'proyecto', kind: 'private', memberIds: [w.owner.id] });
    const gina = await makeUser('gina');
    const res = await inviteGuest(w.o, { email: gina.email, channelIds: [ch.id] });
    if (res.kind !== 'invited') throw new Error('expected invite');
    const mallory = await makeUser('mallory');
    expect(await acceptGuestInvite(res.token, mallory)).toMatchObject({ ok: false, reason: 'email_mismatch' });
    expect((await acceptGuestInvite(res.token, gina)).ok).toBe(true);
    const g: TalkActor = { workspaceId: w.owner.id, personId: gina.id, role: 'member', teamId: null };
    const resolved = await resolveTalkActor({ ...gina, role: 'owner' } as never, { workspaceId: w.owner.id });
    expect(resolved).toMatchObject({ workspaceId: w.owner.id, guest: true });
    const msg = await postMessage(w.a, { channelId: ch.id, body: `plan <@${gina.id}>` });
    await notifyForMessage(w.a, msg.row, msg.channel);
    expect(await notes(gina.id, msg.row.id)).toHaveLength(1);
    expect(await removeGuest(w.o, gina.id)).toBe(true);
    expect(await readableChannel(g, ch.id)).toBeNull();
    expect(await notes(gina.id, msg.row.id)).toHaveLength(0);
    // Ya no puede elegir ese workspace.
    expect((await resolveTalkActor({ ...gina, role: 'owner' } as never, { workspaceId: w.owner.id })).workspaceId).toBe(gina.id);
    // Un miembro no puede invitar.
    await expect(inviteGuest(w.a, { email: 'x@y.test', channelIds: [ch.id] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('quien sale del team deja de ser invitado también', async () => {
    const w = await workspace('g4');
    const ch = await createChannel(w.a, { name: 'mixto', kind: 'public' });
    await getDb().prepare('INSERT INTO talk_guests (workspace_id, user_id, created_at) VALUES (?, ?, ?)').run(w.owner.id, w.bob.id, new Date().toISOString());
    await removeTeamMember(w.team.id, w.bob.id);
    expect(await readableChannel(w.b, ch.id)).toBeNull();
  });
});

describe('no molestar con horario', () => {
  const s = { enabled: true, start: '22:00', end: '08:00', days: [1, 2, 3, 4, 5] };
  it('cruza la medianoche y respeta días y zona horaria', () => {
    // Martes 23:30 en Buenos Aires (UTC-3) = miércoles 02:30 UTC.
    expect(inDndSchedule(s, 'America/Argentina/Buenos_Aires', new Date('2026-10-28T02:30:00Z'))).toBe(true);
    // Martes 12:00 en Buenos Aires.
    expect(inDndSchedule(s, 'America/Argentina/Buenos_Aires', new Date('2026-10-27T15:00:00Z'))).toBe(false);
    // Sábado 07:00 viene del viernes a la noche (día incluido).
    expect(inDndSchedule(s, 'UTC', new Date('2026-10-31T07:00:00Z'))).toBe(true);
    // Domingo 07:00 viene del sábado (no incluido).
    expect(inDndSchedule(s, 'UTC', new Date('2026-11-01T07:00:00Z'))).toBe(false);
    expect(inDndSchedule({ ...s, enabled: false }, 'UTC', new Date('2026-10-28T02:30:00Z'))).toBe(false);
  });

  it('en el horario no sale push; la campana igual se llena', async () => {
    const w = await workspace('dnd');
    const dm = await openDm(w.a, [w.bob.id]);
    await getDb().prepare('INSERT INTO groups_push_subscriptions (id, user_id, person_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), w.bob.id, w.bob.id, `https://push.test/${crypto.randomUUID()}`, '', '', '', new Date().toISOString());
    const pushes = async () => Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM groups_notifications WHERE person_id = ? AND url LIKE '/app/talk/%'").get(w.bob.id)) as { n: number }).n);
    const r1 = await postMessage(w.a, { channelId: dm.id, body: 'uno' });
    await notifyForMessage(w.a, r1.row, r1.channel);
    expect(await pushes()).toBe(1);
    await getDb().prepare("UPDATE talk_prefs SET dnd_schedule = 1, dnd_start = '00:00', dnd_end = '00:00', dnd_days = '0,1,2,3,4,5,6' WHERE workspace_id = ? AND user_id = ?").run(w.owner.id, w.bob.id);
    await getDb().prepare('INSERT OR IGNORE INTO talk_prefs (workspace_id, user_id, dnd_schedule, dnd_start, dnd_end) VALUES (?, ?, 1, ?, ?)').run(w.owner.id, w.bob.id, '00:00', '00:00');
    const r2 = await postMessage(w.a, { channelId: dm.id, body: 'dos' });
    await notifyForMessage(w.a, r2.row, r2.channel);
    expect(await pushes()).toBe(1);
    expect(await notes(w.bob.id, r2.row.id)).toHaveLength(1);
  });

  it('el push sin entregar se borra si la persona deja el privado', async () => {
    const w = await workspace('push');
    const ch = await createChannel(w.a, { name: 'reservado', kind: 'private', memberIds: [w.bob.id] });
    await getDb().prepare('INSERT INTO groups_push_subscriptions (id, user_id, person_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), w.bob.id, w.bob.id, `https://push.test/${crypto.randomUUID()}`, '', '', '', new Date().toISOString());
    const r = await postMessage(w.a, { channelId: ch.id, body: 'secreto' });
    await talkPush(w.owner.id, w.bob.id, { title: 't', body: 'secreto', href: `/app/talk/${ch.id}?m=${r.row.id}`, messageId: r.row.id });
    const count = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_notifications WHERE person_id = ? AND body = ?').get(w.bob.id, 'secreto')) as { n: number }).n);
    expect(await count()).toBe(1);
    await removeMember(w.b, ch.id, w.bob.id);
    expect(await count()).toBe(0);
  });
});

describe('canvas, listas y secciones', () => {
  it('canvas: compare-and-set por rev y nada para quien no lee el privado', async () => {
    const w = await workspace('cv');
    const ch = await createChannel(w.a, { name: 'plan', kind: 'private', memberIds: [w.owner.id] });
    const c1 = await saveCanvas(w.a, ch.id, { title: 'Plan', baseRev: 0 });
    expect(c1.rev).toBe(1);
    const c2 = await saveCanvas(w.o, ch.id, { content: [{ id: 'b1', type: 'paragraph', content: '<script>x</script>hola' }], baseRev: 1 });
    expect(c2.rev).toBe(2);
    expect(JSON.stringify(c2.content)).not.toContain('<script>');
    await expect(saveCanvas(w.a, ch.id, { title: 'viejo', baseRev: 1 })).rejects.toMatchObject({ code: 'canvas_conflict' });
    await expect(getCanvas(w.b, ch.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(saveCanvas(w.b, ch.id, { title: 'x', baseRev: 2 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('listas: valores limpios por tipo y solo personas del canal', async () => {
    const w = await workspace('ls');
    const ch = await createChannel(w.a, { name: 'tareas', kind: 'public' });
    const list = await createList(w.a, ch.id, { name: 'Lanzamiento' });
    expect(list.fields.map((f) => f.type)).toEqual(['select', 'person', 'date']);
    const item = await addItem(w.a, list.id, { title: 'Landing', data: { status: 'Done', owner: w.bob.id, due: '2026-11-01', nope: 'x' } });
    expect(item.data).toEqual({ status: 'Done', owner: null, due: '2026-11-01' });
    expect(cleanData({ status: 'Inventado' }, list.fields, null)).toEqual({ status: null });
    await expect(addItem(w.b, list.id, { title: 'x' })).rejects.toMatchObject({ code: 'not_member' });
    expect((await getList(w.b, list.id)).items).toHaveLength(1);
  });

  it('secciones: propias de cada persona y solo con canales donde está', async () => {
    const w = await workspace('sec');
    const ch = await createChannel(w.a, { name: 'mis-cosas', kind: 'public' });
    const s = await createSection(w.a, 'Proyectos');
    await moveToSection(w.a, ch.id, s.id);
    expect((await listSections(w.a))[0].channelIds).toEqual([ch.id]);
    expect(await listSections(w.b)).toEqual([]);
    await expect(moveToSection(w.b, ch.id, s.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('perfiles: zona horaria válida; un invitado solo ve perfiles de sus canales', async () => {
    const w = await workspace('pf');
    await updateMyProfile(w.b, { title: 'Ventas', timezone: 'Europe/Madrid' });
    await expect(updateMyProfile(w.a, { timezone: 'Marte/Olympus' })).rejects.toMatchObject({ code: 'invalid_timezone' });
    const ch = await createChannel(w.a, { name: 'cliente', kind: 'public' });
    const { g } = await guestOf(w, [ch.id]);
    expect((await listProfiles(g)).some((p) => p.userId === w.bob.id)).toBe(false);
    expect((await listProfiles(w.a)).find((p) => p.userId === w.bob.id)?.title).toBe('Ventas');
  });
});

describe('huddles', () => {
  it('solo miembros entran; la señal va a la persona destino; las pestañas que no laten salen', async () => {
    const w = await workspace('hd');
    const ch = await createChannel(w.a, { name: 'llamada', kind: 'private', memberIds: [w.owner.id] });
    await expect(joinHuddle(w.b, ch.id, 'peer-bob-1234')).rejects.toMatchObject({ code: 'not_found' });
    const a = await joinHuddle(w.a, ch.id, 'peer-ana-1234');
    expect(a.iceServers).toEqual(iceServers(w.ana.id));
    const o = await joinHuddle(w.o, ch.id, 'peer-own-1234');
    expect(o.huddle.id).toBe(a.huddle.id);
    expect(o.huddle.peers).toHaveLength(2);
    await signalHuddle(w.o, a.huddle.id, 'peer-own-1234', 'peer-ana-1234', { type: 'offer', sdp: 'v=0' });
    const ev = (await getDb().prepare("SELECT user_id FROM talk_events WHERE kind = 'signal' AND channel_id = ? ORDER BY id DESC LIMIT 1").get(ch.id)) as { user_id: string };
    expect(ev.user_id).toBe(w.ana.id);
    await expect(signalHuddle(w.b, a.huddle.id, 'peer-bob-1234', 'peer-ana-1234', {})).rejects.toMatchObject({ code: 'huddle_ended' });
    const ended = await sweepHuddles(Date.now() + HUDDLE_STALE_MS + 1000);
    expect(ended).toBeGreaterThanOrEqual(1);
    const row = (await getDb().prepare('SELECT ended_at FROM talk_huddles WHERE id = ?').get(a.huddle.id)) as { ended_at: string | null };
    expect(row.ended_at).not.toBeNull();
  });

  it('TURN con secreto: credencial temporal por persona', () => {
    vi.stubEnv('TALK_TURN_URLS', 'turn:turn.test:3478');
    vi.stubEnv('TALK_TURN_SECRET', 's3cret');
    const servers = iceServers('p1', 1_700_000_000_000);
    const turn = servers.find((s) => String(s.urls).includes('turn:'));
    expect(turn?.username).toBe(`${1_700_000_000 + 3600}:p1`);
    expect(turn?.credential).toBeTruthy();
    vi.unstubAllEnvs();
  });
});

describe('slash commands de apps', () => {
  let server: Server;
  let url = '';
  const seen: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  let reply = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        res.end(reply);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cmd`;
  });
  afterAll(() => server.close());

  it('firma el pedido, responde efímero o en el canal y respeta response_url', async () => {
    const w = await workspace('cmd');
    const ch = await createChannel(w.a, { name: 'deploys', kind: 'public' });
    await expect(createCommand(w.a, { command: '/deploy', url })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createCommand(w.o, { command: '/remind', url })).rejects.toMatchObject({ code: 'invalid_command' });
    const { secret } = await createCommand(w.o, { command: 'deploy', url });
    reply = JSON.stringify({ text: 'Desplegando…' });
    const r1 = await runCommand(w.a, { channelId: ch.id, command: '/deploy', text: 'prod' });
    expect(r1.ephemeral).toBe('Desplegando…');
    const req = seen[seen.length - 1];
    const ts = String(req.headers['x-talk-request-timestamp']);
    expect(req.headers['x-talk-signature']).toBe(signBody(secret, ts, req.body));
    const form = new URLSearchParams(req.body);
    expect(form.get('text')).toBe('prod');
    reply = JSON.stringify({ text: 'Listo', response_type: 'in_channel' });
    const r2 = await runCommand(w.a, { channelId: ch.id, command: '/deploy', text: '' });
    expect(r2.message?.botName).toBe('/deploy');
    // response_url: hasta 5 usos, y quien invocó tiene que seguir pudiendo escribir.
    const token = new URL(String(form.get('response_url'))).searchParams.get('token')!;
    await respondToCommand(token, { text: 'Terminó', response_type: 'in_channel' });
    await removeMember(w.a, ch.id, w.ana.id);
    await expect(respondToCommand(token, { text: 'otra' })).rejects.toMatchObject({ code: 'not_member' });
    // Solo miembros pueden correrlo.
    await expect(runCommand(w.b, { channelId: ch.id, command: '/deploy', text: '' })).rejects.toMatchObject({ code: 'not_member' });
    expect(parseReply('hola', 'text/plain')).toEqual({ text: 'hola', responseType: 'ephemeral' });
    expect(parseReply('', null)).toBeNull();
  });
});

describe('IA: solo lo que quien pregunta puede leer', () => {
  it('no resume ni cita privados ajenos', async () => {
    const w = await workspace('ai');
    const priv = await createChannel(w.a, { name: 'directorio', kind: 'private' });
    const pub = await createChannel(w.a, { name: 'novedades', kind: 'public' });
    await postMessage(w.a, { channelId: priv.id, body: 'bonos del directorio confidencial' });
    await postMessage(w.a, { channelId: pub.id, body: 'bonos de fin de año anunciados' });
    await expect(summarizeChannel(w.b, priv.id, 'week')).rejects.toMatchObject({ code: 'not_found' });
    const s = await summarizeChannel(w.a, priv.id, 'week');
    expect(s.count).toBe(1);
    const ans = await askTalk(w.b, 'bonos');
    expect(ans.sources.map((x) => x.channelId)).toEqual([pub.id]);
  });
});

describe('retención y export', () => {
  it('borra lo viejo y el export público es de admins', async () => {
    const w = await workspace('ret');
    const ch = await createChannel(w.a, { name: 'viejo', kind: 'public' });
    const old = await postMessage(w.a, { channelId: ch.id, body: 'muy viejo' });
    await postMessage(w.a, { channelId: ch.id, body: 'nuevo' });
    await getDb().prepare('UPDATE talk_messages SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 40 * 86_400_000).toISOString(), old.row.id);
    await expect(setTalkSettings(w.a, { retentionDays: 30 })).rejects.toMatchObject({ code: 'forbidden' });
    await setTalkSettings(w.o, { retentionDays: 30 });
    expect(await applyRetention()).toBeGreaterThanOrEqual(1);
    expect(await getDb().prepare('SELECT 1 FROM talk_messages WHERE id = ?').get(old.row.id)).toBeUndefined();
    await expect(exportTalk(w.a, 'public')).rejects.toMatchObject({ code: 'forbidden' });
    const priv = await createChannel(w.a, { name: 'solo-ana', kind: 'private' });
    const mine = await exportTalk(w.b, 'mine');
    expect(mine.channels.some((c) => c.id === priv.id)).toBe(false);
    const pubExport = await exportTalk(w.o, 'public');
    expect(pubExport.channels.some((c) => c.id === priv.id)).toBe(false);
    expect(pubExport.channels.find((c) => c.id === ch.id)?.messages.map((m) => m.text)).toEqual(['nuevo']);
  });
});
