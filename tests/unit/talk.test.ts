import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import {
  decodeMentions,
  encodeMentions,
  extractMentions,
  extractUrls,
  normalizeChannelName,
  parseInline,
  parseTalkMarkdown,
  safeHref,
  talkPlainText,
} from '@/lib/talk-markdown';
import { parseTalkSearch, tokenize } from '@/lib/talk-search';
import { parseRemindCommand, parseWhen, presetTime } from '@/lib/talk-time';
import { emojiFromName, isValidReaction, searchEmoji } from '@/lib/talk-emoji';
import {
  TalkError,
  afterPost,
  browseChannels,
  createChannel,
  deleteChannel,
  deleteMessage,
  editMessage,
  ensureGeneral,
  getThread,
  inviteMembers,
  joinChannel,
  listActivity,
  listChannelMessages,
  listEventsSince,
  listMyChannels,
  listThreads,
  markRead,
  openDm,
  postMessage,
  readableChannel,
  removeMember,
  setPinned,
  toggleReaction,
  updateChannel,
  type TalkActor,
} from '@/lib/talk';
import { createHook, createReminder, hookByToken, listLater, saveDraft, listDrafts, scheduleMessage, searchMessages, setSaved, setStatus, listPresence, heartbeat } from '@/lib/talk-extras';
import { fireTalkReminders, sendScheduledMessages, sendTalkEmails, notifyForMessage } from '@/lib/talk-notify';
import { parseSuiteRef, resolveRefs } from '@/lib/talk-unfurl';
import { postAsBot } from '@/lib/talk-bot';
import { sseFrame, requestCursor } from '@/lib/realtime';
import { searchApps } from '@/lib/app-search';
import { createProject, createIssue } from '@/lib/track-data';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const bob = await makeUser(`${label}-bob`);
  const outsider = await makeUser(`${label}-out`);
  const team = await createTeam(owner.id, `${label} team`);
  await addMember(team.id, ana.id);
  await addMember(team.id, bob.id);
  const actor = (id: string, role: TalkActor['role'] = 'member'): TalkActor => ({ workspaceId: owner.id, personId: id, role, teamId: team.id });
  return { owner, ana, bob, outsider, team, o: actor(owner.id, 'owner'), a: actor(ana.id), b: actor(bob.id), x: { workspaceId: owner.id, personId: outsider.id, role: 'member', teamId: null } as TalkActor };
}

describe('talk markdown', () => {
  it('parses blocks and inline formatting without HTML', () => {
    const blocks = parseTalkMarkdown('hola *mundo* _it_ ~no~ `x<y`\n> cita\n- uno\n- dos\n1. a\n2. b\n```\nconst a = 1;\n```');
    expect(blocks.map((b) => b.t)).toEqual(['p', 'quote', 'ul', 'ol', 'pre']);
    const p = blocks[0];
    expect(p.t === 'p' && p.c.map((n) => n.t)).toEqual(['text', 'b', 'text', 'i', 'text', 's', 'text', 'code']);
    expect(blocks[4]).toEqual({ t: 'pre', v: 'const a = 1;' });
  });

  it('does not treat snake_case or 2*3*4 as formatting', () => {
    expect(parseInline('snake_case_name').map((n) => n.t)).toEqual(['text']);
    expect(parseInline('2*3*4').map((n) => n.t)).toEqual(['text']);
  });

  it('links: bare, slack style and markdown; rejects javascript:', () => {
    const nodes = parseInline('ver https://example.com/a?b=1. y <https://x.io|X> y [doc](https://d.io) y [mal](javascript:alert(1))');
    const links = nodes.filter((n) => n.t === 'link');
    expect(links.map((l) => l.t === 'link' && l.href)).toEqual(['https://example.com/a?b=1', 'https://x.io/', 'https://d.io/']);
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(extractUrls('a https://a.com b https://a.com c https://b.com')).toEqual(['https://a.com/', 'https://b.com/']);
  });

  it('mentions, specials and emoji', () => {
    const body = encodeMentions('hola @Ana María y @Ana, @channel :tada: #general', { users: { 'Ana María': 'u1', Ana: 'u2' }, channels: { general: 'c1' } });
    expect(body).toBe('hola <@u1> y <@u2>, <!channel> :tada: <#c1>');
    expect(extractMentions(body)).toEqual({ users: ['u1', 'u2'], groups: [], channel: true, here: false });
    expect(talkPlainText(body, { user: (id) => (id === 'u1' ? 'Ana María' : 'Ana'), channel: () => 'general' })).toBe('hola @Ana María y @Ana, @channel 🎉 #general');
    const back = decodeMentions(body, { user: (id) => (id === 'u1' ? 'Ana María' : 'Ana'), channel: () => 'general' });
    expect(back.text).toBe('hola @Ana María y @Ana, @channel :tada: #general');
    expect(encodeMentions(back.text, back)).toBe(body);
    expect(extractMentions('```\n<@u9>\n```').users).toEqual([]);
    expect(encodeMentions('mail a@here.com y @aquí')).toBe('mail a@here.com y <!here>');
  });

  it('normalizes channel names like Slack', () => {
    expect(normalizeChannelName('  #Plan Q4 Ventas!! ')).toBe('plan-q4-ventas');
    expect(normalizeChannelName('dev_ops')).toBe('dev_ops');
    expect(normalizeChannelName('***')).toBe('');
  });

  it('emoji helpers', () => {
    expect(emojiFromName('tada')).toBe('🎉');
    expect(searchEmoji('thu')[0].name).toBe('thumbsup');
    expect(isValidReaction('👍')).toBe(true);
    expect(isValidReaction('<b>')).toBe(false);
    expect(isValidReaction('hola')).toBe(false);
  });
});

describe('talk search parser', () => {
  it('reads modifiers', () => {
    const q = parseTalkSearch('deploy "staging roto" -prod in:#dev from:@ana from:"Bob Ross" has:link has::eyes: is:saved on:2026-10-01');
    expect(q.terms).toEqual(['deploy', 'staging roto']);
    expect(q.excludes).toEqual(['prod']);
    expect(q.in).toEqual(['dev']);
    expect(q.from).toEqual(['ana', 'Bob Ross']);
    expect(q.has).toEqual(['link']);
    expect(q.hasEmoji).toEqual(['eyes']);
    expect(q.is).toEqual(['saved']);
    expect(q.after).toBe('2026-10-01T00:00:00.000Z');
    expect(q.before).toBe('2026-10-02T00:00:00.000Z');
    expect(tokenize('from:"A B" x')).toEqual(['from:A B', 'x']);
  });

  it('during: month and after: next day', () => {
    expect(parseTalkSearch('during:2026-02').before).toBe('2026-03-01T00:00:00.000Z');
    expect(parseTalkSearch('after:2026-01-31').after).toBe('2026-02-01T00:00:00.000Z');
    expect(parseTalkSearch('in:@ana').in).toEqual(['@ana']);
  });
});

describe('talk time parsing', () => {
  const now = new Date(2026, 9, 25, 10, 0, 0); // domingo 25/10 10:00 local
  it('relative and clock times', () => {
    expect(parseWhen('in 1h', now)?.getTime()).toBe(now.getTime() + 3_600_000);
    expect(parseWhen('en 20 minutos', now)?.getTime()).toBe(now.getTime() + 20 * 60_000);
    const tomorrow = parseWhen('mañana a las 9:30', now)!;
    expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([26, 9, 30]);
    const at = parseWhen('at 8', now)!;
    expect([at.getDate(), at.getHours()]).toEqual([26, 8]);
    expect(parseWhen('whenever', now)).toBeNull();
    expect(presetTime('nextweek', now).getDay()).toBe(1);
  });

  it('/remind commands', () => {
    expect(parseRemindCommand('/remind me in 1h to call Ana', now)).toEqual({ text: 'call Ana', at: new Date(now.getTime() + 3_600_000) });
    const r = parseRemindCommand('/recordar revisar el deploy en 20 min', now)!;
    expect(r.text).toBe('revisar el deploy');
    expect(r.at.getTime()).toBe(now.getTime() + 20 * 60_000);
    expect(parseRemindCommand('/lembrar amanhã pagar a conta', now)?.text).toBe('pagar a conta');
    expect(parseRemindCommand('/remind me something', now)).toBeNull();
  });
});

describe('talk data', () => {
  it('channels: general, create, rename, archive, privacy', async () => {
    const w = await workspace('ch');
    await ensureGeneral(w.o);
    await ensureGeneral(w.a);
    const mine = await listMyChannels(w.a);
    expect(mine.map((c) => c.name)).toContain('general');
    const pub = await createChannel(w.a, { name: 'Plan Q4', kind: 'public' });
    expect(pub.name).toBe('plan-q4');
    await expect(createChannel(w.b, { name: 'plan q4', kind: 'public' })).rejects.toMatchObject({ code: 'name_taken' });
    const priv = await createChannel(w.a, { name: 'secret', kind: 'private' });
    expect(await readableChannel(w.b, priv.id)).toBeNull();
    expect((await browseChannels(w.b)).map((c) => c.name)).not.toContain('secret');
    await inviteMembers(w.a, priv.id, [w.bob.id]);
    expect(await readableChannel(w.b, priv.id)).not.toBeNull();
    // Bob no lo creó ni es admin: no lo renombra.
    await expect(updateChannel(w.b, priv.id, { name: 'otro' })).rejects.toMatchObject({ code: 'forbidden' });
    const renamed = await updateChannel(w.a, priv.id, { name: 'Muy Secreto', topic: 'shh' });
    expect([renamed.name, renamed.topic]).toEqual(['muy-secreto', 'shh']);
    await updateChannel(w.a, pub.id, { archived: true });
    await expect(postMessage(w.a, { channelId: pub.id, body: 'hola' })).rejects.toMatchObject({ code: 'channel_archived' });
    const general = mine.find((c) => c.name === 'general')!;
    await expect(updateChannel(w.o, general.id, { archived: true })).rejects.toMatchObject({ code: 'general_locked' });
    await expect(removeMember(w.a, general.id, w.ana.id)).rejects.toMatchObject({ code: 'general_locked' });
    await deleteChannel(w.a, priv.id);
    expect(await readableChannel(w.a, priv.id)).toBeNull();
  });

  it('outsider of another workspace cannot read', async () => {
    const w = await workspace('iso');
    const other = await makeUser('iso-other');
    const c = await createChannel(w.a, { name: 'pub', kind: 'public' });
    const foreign: TalkActor = { workspaceId: other.id, personId: other.id, role: 'owner', teamId: null };
    expect(await readableChannel(foreign, c.id)).toBeNull();
  });

  it('messages: post, mention notification, thread, reactions, edit, delete, unread', async () => {
    const w = await workspace('msg');
    const c = await createChannel(w.a, { name: 'dev', kind: 'public', memberIds: [w.bob.id] });
    await expect(postMessage(w.o, { channelId: c.id, body: 'x' })).rejects.toMatchObject({ code: 'not_member' });
    const r1 = await postMessage(w.a, { channelId: c.id, body: `hola <@${w.bob.id}> mirá https://example.com` });
    await afterPost(w.a, r1);
    const notes = (await getDb().prepare("SELECT type, title, href FROM notifications WHERE user_id = ? AND source_type = 'talk_message'").all(w.bob.id)) as Array<{ type: string; title: string; href: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('talk_mention');
    expect(notes[0].href).toBe(`/app/talk/${c.id}?m=${r1.row.id}`);
    // Bob tiene sin leer con una mención.
    let bobDev = (await listMyChannels(w.b)).find((x) => x.id === c.id)!;
    expect([bobDev.unread, bobDev.mentions]).toEqual([true, 1]);
    await markRead(w.b, c.id);
    bobDev = (await listMyChannels(w.b)).find((x) => x.id === c.id)!;
    expect([bobDev.unread, bobDev.mentions]).toEqual([false, 0]);

    // Hilo con "también enviar al canal".
    const reply = await postMessage(w.b, { channelId: c.id, body: 'respuesta', parentId: r1.row.id, alsoInChannel: true });
    await postMessage(w.b, { channelId: c.id, body: 'solo hilo', parentId: r1.row.id });
    const thread = await getThread(w.a, r1.row.id);
    expect(thread.root.replyCount).toBe(2);
    expect(thread.replies.map((m) => m.body)).toEqual(['respuesta', 'solo hilo']);
    const list = await listChannelMessages(w.a, c.id);
    expect(list.messages.map((m) => m.body)).toEqual([r1.row.body, 'respuesta']);
    expect((await listThreads(w.a))[0].unread).toBe(true);
    await expect(postMessage(w.a, { channelId: c.id, body: 'x', parentId: reply.row.id })).rejects.toMatchObject({ code: 'invalid_parent' });

    // Reacciones.
    const reacted = await toggleReaction(w.b, r1.row.id, '👍');
    expect(reacted.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, users: [w.bob.id] }]);
    expect((await toggleReaction(w.b, r1.row.id, '👍')).reactions).toEqual([]);
    await expect(toggleReaction(w.b, r1.row.id, 'hola')).rejects.toMatchObject({ code: 'invalid_emoji' });

    // Editar: solo el autor.
    await expect(editMessage(w.b, r1.row.id, 'hack')).rejects.toMatchObject({ code: 'forbidden' });
    const edited = await editMessage(w.a, r1.row.id, 'editado');
    expect([edited.body, !!edited.editedAt]).toEqual(['editado', true]);

    // Fijar.
    expect((await setPinned(w.b, r1.row.id, true)).pinned).toBe(true);

    // Borrar un raíz con respuestas deja "fue borrado".
    await deleteMessage(w.a, r1.row.id);
    const after = await listChannelMessages(w.a, c.id);
    expect(after.messages[0].deleted).toBe(true);
    expect(after.messages[0].body).toBe('');
    await expect(deleteMessage(w.a, reply.row.id)).rejects.toMatchObject({ code: 'forbidden' });
    // Un admin del workspace sí puede.
    await deleteMessage(w.o, reply.row.id);
  });

  it('@channel, @here and keywords', async () => {
    const w = await workspace('bc');
    const c = await createChannel(w.a, { name: 'all', kind: 'public', memberIds: [w.bob.id, w.owner.id] });
    await heartbeat(w.b);
    const r = await postMessage(w.a, { channelId: c.id, body: 'aviso <!here>' });
    const n = await notifyForMessage(w.a, r.row, r.channel);
    expect(n).toBe(1); // solo Bob está activo
    await getDb().prepare('INSERT OR REPLACE INTO talk_prefs (workspace_id, user_id, keywords) VALUES (?, ?, ?)').run(w.owner.id, w.owner.id, 'factura');
    const r2 = await postMessage(w.a, { channelId: c.id, body: 'llegó la FACTURA' });
    expect(await notifyForMessage(w.a, r2.row, r2.channel)).toBe(1);
  });

  it('DMs are deduplicated and private', async () => {
    const w = await workspace('dm');
    const d1 = await openDm(w.a, [w.bob.id]);
    const d2 = await openDm(w.b, [w.ana.id]);
    expect(d1.id).toBe(d2.id);
    expect(d1.kind).toBe('dm');
    const g = await openDm(w.a, [w.bob.id, w.owner.id]);
    expect(g.kind).toBe('group');
    expect(await readableChannel(w.o, d1.id)).toBeNull(); // ni el owner lee DMs ajenos
    await expect(openDm(w.a, [w.outsider.id])).rejects.toMatchObject({ code: 'invalid_member' });
    const r = await postMessage(w.a, { channelId: d1.id, body: 'hola' });
    await notifyForMessage(w.a, r.row, r.channel);
    const types = (await getDb().prepare("SELECT type FROM notifications WHERE user_id = ? AND source_id = ?").all(w.bob.id, r.row.id)) as Array<{ type: string }>;
    expect(types.map((t) => t.type)).toEqual(['talk_dm']);
    // Mensaje programado en el DM, enviado por el cron.
    await expect(scheduleMessage(w.a, { channelId: d1.id, body: 'luego', sendAt: new Date(Date.now() + 5_000).toISOString() })).rejects.toMatchObject({ code: 'invalid_time' });
    const s = await scheduleMessage(w.a, { channelId: d1.id, body: 'luego', sendAt: new Date(Date.now() + 60_000).toISOString() });
    expect(s.status).toBe('pending');
    expect((await sendScheduledMessages({ now: new Date(Date.now() + 120_000) })).sent).toBe(1);
    expect((await sendScheduledMessages({ now: new Date(Date.now() + 120_000) })).sent).toBe(0);
    expect((await listChannelMessages(w.b, d1.id)).messages.map((m) => m.body)).toEqual(['hola', 'luego']);
  });

  it('events feed only shows what the person can see', async () => {
    const w = await workspace('ev');
    const priv = await createChannel(w.a, { name: 'priv', kind: 'private' });
    const start = (await listEventsSince(w.b, 0)).cursor;
    await postMessage(w.a, { channelId: priv.id, body: 'secreto' });
    const pub = await createChannel(w.a, { name: 'pub', kind: 'public' });
    await postMessage(w.a, { channelId: pub.id, body: 'abierto' });
    const evs = await listEventsSince(w.b, start);
    expect(evs.events.every((e) => e.channelId !== priv.id)).toBe(true);
    expect(evs.events.some((e) => e.channelId === pub.id && e.kind === 'message')).toBe(true);
    expect(evs.cursor).toBeGreaterThan(start);
  });

  it('saved, reminders, drafts and email queue', async () => {
    const w = await workspace('later');
    const c = await createChannel(w.a, { name: 'later', kind: 'public', memberIds: [w.bob.id] });
    const r = await postMessage(w.a, { channelId: c.id, body: `ping <@${w.bob.id}>` });
    await setSaved(w.b, r.row.id, true);
    await createReminder(w.b, { messageId: r.row.id, remindAt: new Date(Date.now() + 60_000).toISOString() });
    await createReminder(w.b, { text: 'llamar a Ana', remindAt: new Date(Date.now() + 60_000).toISOString() });
    const later = await listLater(w.b);
    expect(later).toHaveLength(2);
    expect(await fireTalkReminders({ now: new Date(Date.now() + 120_000) })).toBe(2);
    expect(await fireTalkReminders({ now: new Date(Date.now() + 120_000) })).toBe(0);
    const reminders = (await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'talk_reminder'").get(w.bob.id)) as { n: number };
    expect(Number(reminders.n)).toBe(2);

    await saveDraft(w.b, c.id, null, 'a medio escribir');
    expect((await listDrafts(w.b)).map((d) => d.body)).toEqual(['a medio escribir']);
    await postMessage(w.b, { channelId: c.id, body: 'listo' });
    expect(await listDrafts(w.b)).toEqual([]);

    // Email de la mención si sigue sin leer después del delay.
    await notifyForMessage(w.a, r.row, r.channel);
    const sent = await sendTalkEmails({ now: new Date(Date.now() + 10 * 60_000) });
    expect(sent.sent + sent.skipped).toBeGreaterThanOrEqual(1);
    const again = await sendTalkEmails({ now: new Date(Date.now() + 10 * 60_000) });
    expect(again.sent).toBe(0);
  });

  it('search with filters', async () => {
    const w = await workspace('srch');
    const dev = await createChannel(w.a, { name: 'dev', kind: 'public', memberIds: [w.bob.id] });
    const ops = await createChannel(w.a, { name: 'ops', kind: 'private' });
    await postMessage(w.a, { channelId: dev.id, body: 'deploy listo https://ci.example.com' });
    await postMessage(w.b, { channelId: dev.id, body: 'deploy roto' });
    await postMessage(w.a, { channelId: ops.id, body: 'deploy secreto' });
    expect((await searchMessages(w.b, 'deploy')).results.map((r) => r.message.body).sort()).toEqual(['deploy listo https://ci.example.com', 'deploy roto']);
    expect((await searchMessages(w.a, 'deploy in:#ops')).results).toHaveLength(1);
    expect((await searchMessages(w.a, 'deploy has:link')).results).toHaveLength(1);
    expect((await searchMessages(w.a, `from:${w.bob.email.split('@')[0]}`)).results.map((r) => r.message.body)).toEqual(['deploy roto']);
    expect((await searchMessages(w.a, 'deploy -roto in:#dev')).results).toHaveLength(1);
    expect((await searchMessages(w.a, 'dev')).channels.map((c) => c.name)).toContain('dev');
  });

  it('activity lists mentions; join and presence', async () => {
    const w = await workspace('act');
    const c = await createChannel(w.a, { name: 'act', kind: 'public' });
    await joinChannel(w.b, c.id);
    await postMessage(w.a, { channelId: c.id, body: `che <@${w.bob.id}>` });
    expect((await listActivity(w.b)).map((x) => x.message.body)).toEqual([`che <@${w.bob.id}>`]);
    await setStatus(w.b, { emoji: '📅', text: 'En reunión', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const p = (await listPresence(w.owner.id)).find((x) => x.userId === w.bob.id)!;
    expect([p.statusEmoji, p.statusText]).toEqual(['📅', 'En reunión']);
  });

  it('suite refs resolve per viewer', async () => {
    const w = await workspace('refs');
    const project = await createProject(w.owner.id, w.team.id, { name: 'Refs' } as never);
    const issue = await createIssue(project.id, w.owner.id, { title: 'Arreglar login' }, { source: 'app' });
    expect(parseSuiteRef(`https://zerosoft.ai/es/app/track/issues/${issue.id}`)).toEqual({ kind: 'issue', id: issue.id });
    const refs = await resolveRefs(w.a, [{ id: 'm1', body: `mirá https://zerosoft.ai/en/app/track/issues/${issue.id}` }]);
    expect(refs.get('m1')?.[0]).toMatchObject({ kind: 'issue', title: 'Arreglar login' });
    const other = await makeUser('refs-other');
    const foreign: TalkActor = { workspaceId: other.id, personId: other.id, role: 'owner', teamId: null };
    expect((await resolveRefs(foreign, [{ id: 'm1', body: `https://zerosoft.ai/en/app/track/issues/${issue.id}` }])).size).toBe(0);
  });

  it('incoming webhooks and bots', async () => {
    const w = await workspace('hook');
    const c = await createChannel(w.a, { name: 'alerts', kind: 'public' });
    const { token } = await createHook(w.a, c.id, 'CI');
    const hook = await hookByToken(token);
    expect(hook?.channel_id).toBe(c.id);
    expect(await hookByToken('zth_nope')).toBeNull();
    const msg = await postAsBot(w.owner.id, { channel: 'alerts', body: 'build ok', botName: 'CI', memberId: w.ana.id });
    expect([msg.botName, msg.userId]).toEqual(['CI', null]);
    const dm = await openDm(w.a, [w.bob.id]);
    await expect(postAsBot(w.owner.id, { channel: dm.id, body: 'x', botName: 'CI', memberId: w.ana.id })).rejects.toBeInstanceOf(TalkError);
  });

  it('⌘K finds channels and DMs the person can see', async () => {
    const w = await workspace('cmdk');
    await createChannel(w.a, { name: 'zebra-room', kind: 'public' });
    await createChannel(w.a, { name: 'zebra-secret', kind: 'private' });
    const items = await searchApps({ id: w.owner.id, actingUser: { id: w.bob.id }, team: w.team, role: 'member' }, 'zebra');
    expect(items.filter((i) => i.group === 'talkChannels').map((i) => i.label)).toEqual(['#zebra-room']);
  });
});

describe('realtime helpers', () => {
  it('sse frames and cursor', () => {
    expect(sseFrame('events', { a: 1 }, 7)).toBe('id: 7\nevent: events\ndata: {"a":1}\n\n');
    expect(requestCursor(new Request('http://x/s?cursor=5'))).toBe(5);
    expect(requestCursor(new Request('http://x/s', { headers: { 'last-event-id': '9' } }))).toBe(9);
    expect(requestCursor(new Request('http://x/s?cursor=-3'))).toBe(0);
  });
});
