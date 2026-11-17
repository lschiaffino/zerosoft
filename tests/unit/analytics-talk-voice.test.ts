import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { analyticsRange } from '@/lib/analytics-kit/period';
import { addMember, createTeam } from '@/lib/teams';
import { createChannel, joinChannel, openDm, postMessage, toggleReaction, type TalkActor } from '@/lib/talk';
import { aggregateTalk, isTalkAnalyticsEmpty, talkAnalytics } from '@/lib/talk-analytics';
import { aggregateVoice, isVoiceAnalyticsEmpty, voiceAnalytics } from '@/lib/voice-analytics';
import { createSession, type VoiceOwner } from '@/lib/voice';
import { makeUser } from './helpers';

const now = new Date('2030-03-12T12:00:00Z');
const range = analyticsRange({ days: 7, tz: 'UTC' }, now);
const at = (iso: string) => Date.parse(iso);

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

describe('Talk: analítica con el kit', () => {
  const input = {
    channels: [
      { id: 'c1', kind: 'public' as const, name: 'general', members: 5, archived: false },
      { id: 'c2', kind: 'private' as const, name: 'ventas', members: 2, archived: false },
      { id: 'd1', kind: 'dm' as const, name: '', members: 2, archived: false },
      { id: 'c3', kind: 'public' as const, name: 'viejo', members: 1, archived: true },
    ],
    messages: [
      { channel_id: 'c1', user_id: 'ana', reply: false, at: at('2030-03-11T15:00:00Z') },
      { channel_id: 'c1', user_id: 'bo', reply: true, at: at('2030-03-11T15:30:00Z') },
      { channel_id: 'c2', user_id: 'ana', reply: false, at: at('2030-03-10T09:00:00Z') },
      { channel_id: 'd1', user_id: 'bo', reply: false, at: at('2030-03-10T10:00:00Z') },
      // Período anterior.
      { channel_id: 'c1', user_id: 'ana', reply: false, at: at('2030-03-02T10:00:00Z') },
      // De un canal que no ve: no cuenta.
      { channel_id: 'cx', user_id: 'ana', reply: false, at: at('2030-03-11T10:00:00Z') },
    ],
    reactions: [
      { channel_id: 'c1', user_id: 'bo', at: at('2030-03-11T16:00:00Z') },
      { channel_id: 'c1', user_id: 'ana', at: at('2030-03-03T16:00:00Z') },
    ],
    huddles: [
      { channel_id: 'c1', started: at('2030-03-11T17:00:00Z'), ended: at('2030-03-11T17:30:00Z') },
      // En curso: cuenta hasta ahora.
      { channel_id: 'c2', started: at('2030-03-12T11:00:00Z'), ended: null },
      { channel_id: 'c1', started: at('2030-03-04T17:00:00Z'), ended: at('2030-03-04T17:10:00Z') },
    ],
    names: new Map([
      ['ana', 'Ana'],
      ['bo', 'Bo'],
    ]),
  };

  it('cuenta mensajes, respuestas, personas, reacciones y huddles contra el período anterior', () => {
    const d = aggregateTalk(range, input, undefined, now.getTime());
    expect(d.kpis.messages).toEqual({ value: 4, prev: 1 });
    expect(d.kpis.replies).toEqual({ value: 1, prev: 0 });
    expect(d.kpis.people).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.reactions).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.huddles).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.huddleMinutes).toEqual({ value: 90, prev: 10 });
    expect(d.perDay.find((p) => p.day === '2030-03-11')).toMatchObject({ messages: 2, replies: 1, reactions: 1 });
    expect(d.people.map((p) => [p.name, p.messages, p.channels, p.prevMessages])).toEqual([
      // Empatados en mensajes: primero quien más reaccionó.
      ['Bo', 2, 2, 0],
      ['Ana', 2, 2, 1],
    ]);
    // La tabla nombra canales, no DMs; por tipo sí están.
    expect(d.channels.map((c) => [c.id, c.messages, c.posters, c.replies, c.reactions])).toEqual([
      ['c1', 2, 2, 1, 1],
      ['c2', 1, 1, 0, 0],
    ]);
    expect(d.kinds).toEqual([
      { kind: 'public', messages: 2, channels: 1 },
      { kind: 'private', messages: 1, channels: 1 },
      { kind: 'dm', messages: 1, channels: 1 },
    ]);
    // El filtro lista los canales sin archivar.
    expect(d.channelList.map((c) => c.id)).toEqual(['c1', 'c2']);
    // 2030-03-11 fue lunes.
    expect(d.heat[0][15]).toBe(2);
    expect(isTalkAnalyticsEmpty(d)).toBe(false);
  });

  it('filtra por canal y sin canales está vacío', () => {
    const one = aggregateTalk(range, input, 'c2', now.getTime());
    expect(one.kpis.messages).toEqual({ value: 1, prev: 0 });
    expect(one.kpis.huddles.value).toBe(1);
    expect(isTalkAnalyticsEmpty(aggregateTalk(range, { ...input, channels: [] }))).toBe(true);
  });

  it('con la base: solo los canales que la persona lee, sin bots, borrados ni el texto', async () => {
    const owner = await makeUser('talk-an-owner');
    const ana = await makeUser('talk-an-ana');
    const bo = await makeUser('talk-an-bo');
    const team = await createTeam(owner.id, 'talk-an team');
    await addMember(team.id, ana.id);
    await addMember(team.id, bo.id);
    const actor = (id: string): TalkActor => ({ workspaceId: owner.id, personId: id, role: id === owner.id ? 'owner' : 'member', teamId: team.id });
    const pub = await createChannel(actor(ana.id), { name: `pub-${Date.now()}`, kind: 'public' });
    const priv = await createChannel(actor(bo.id), { name: `priv-${Date.now()}`, kind: 'private' });
    await joinChannel(actor(bo.id), pub.id);
    const posted = await postMessage(actor(ana.id), { channelId: pub.id, body: 'hola' });
    await postMessage(actor(bo.id), { channelId: pub.id, body: 'r', parentId: posted.message.id });
    await postMessage(actor(bo.id), { channelId: priv.id, body: 'secreto' });
    await postMessage(actor(ana.id), { channelId: pub.id, body: 'bot' }, { asBot: true }).catch(() => null);
    await postMessage(actor(ana.id), { channelId: pub.id, body: 'x', botName: 'Flow' }).catch(() => null);
    const gone = await postMessage(actor(ana.id), { channelId: pub.id, body: 'borrado' });
    await getDb().prepare('UPDATE talk_messages SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), gone.message.id);
    const dm = await openDm(actor(bo.id), [owner.id]);
    await postMessage(actor(bo.id), { channelId: dm.id, body: 'dm' });
    await toggleReaction(actor(bo.id), posted.message.id, '👍', true);
    const q = { days: 7, tz: 'UTC' };

    const asAna = await talkAnalytics(actor(ana.id), undefined, q);
    // Ve el público (2 de personas), no el privado de Bo ni su DM.
    expect(asAna.kpis.messages.value).toBe(2);
    expect(asAna.kpis.replies.value).toBe(1);
    expect(asAna.kpis.reactions.value).toBe(1);
    expect(asAna.channelList.map((c) => c.id)).toContain(pub.id);
    expect(asAna.channelList.map((c) => c.id)).not.toContain(priv.id);

    const asBo = await talkAnalytics(actor(bo.id), undefined, q);
    expect(asBo.kpis.messages.value).toBe(4);
    expect(asBo.kinds.map((k) => k.kind)).toEqual(['public', 'private', 'dm']);
    expect(JSON.stringify(asBo)).not.toMatch(/hola|secreto|borrado/);

    const onlyPriv = await talkAnalytics(actor(bo.id), priv.id, q);
    expect(onlyPriv.kpis.messages.value).toBe(1);
    // Un canal que no ve, como filtro, no filtra.
    expect((await talkAnalytics(actor(ana.id), priv.id, q)).kpis.messages.value).toBe(2);

    // Alguien que no está en Talk del workspace no ve nada.
    const stranger = await makeUser('talk-an-x');
    const none = await talkAnalytics({ workspaceId: owner.id, personId: stranger.id, role: 'member', teamId: null }, undefined, q);
    expect(none.channelCount).toBe(0);
    expect(isTalkAnalyticsEmpty(none)).toBe(true);
  });
});

describe('Voice: analítica con el kit', () => {
  const s = (over: Partial<Parameters<typeof aggregateVoice>[1][number]>) => ({
    id: Math.random().toString(36).slice(2),
    kind: 'dictation' as const,
    title: '',
    app: 'docs',
    duration_ms: 60_000,
    words: 100,
    notes: false,
    linked: false,
    at: at('2030-03-11T09:00:00Z'),
    ...over,
  });
  const sessions = [
    s({ id: 'm1', kind: 'meeting', title: 'Pricing', duration_ms: 30 * 60_000, words: 3000, notes: true, linked: true, at: at('2030-03-10T14:00:00Z') }),
    s({ id: 'm0', kind: 'meeting', duration_ms: 10 * 60_000, at: at('2030-03-02T14:00:00Z') }),
    s({ app: 'docs', words: 120, duration_ms: 60_000 }),
    s({ app: 'crm', words: 60, duration_ms: 60_000 }),
    s({ app: 'docs', words: 50, duration_ms: 30_000, at: at('2030-03-03T09:00:00Z') }),
  ];

  it('cuenta reuniones, tiempo, notas, dictados, palabras y ritmo contra el período anterior', () => {
    const d = aggregateVoice(range, sessions, 5);
    expect(d.kpis.meetings).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.meetingMinutes).toEqual({ value: 30, prev: 10 });
    expect(d.kpis.notes).toEqual({ value: 1, prev: 0 });
    expect(d.kpis.dictations).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.words).toEqual({ value: 180, prev: 50 });
    expect(d.kpis.wpm).toEqual({ value: 90, prev: 100 });
    expect(d.apps.map((a) => [a.app, a.words, a.dictations, a.prevWords])).toEqual([
      ['docs', 120, 1, 50],
      ['crm', 60, 1, 0],
    ]);
    expect(d.meetings).toEqual([{ id: 'm1', title: 'Pricing', at: at('2030-03-10T14:00:00Z'), minutes: 30, words: 3000, notes: true, linked: true }]);
    expect(d.perDay.find((p) => p.day === '2030-03-11')).toMatchObject({ meetings: 0, dictations: 2 });
    expect(d.heat[0][9]).toBe(2);
    expect(isVoiceAnalyticsEmpty(d)).toBe(false);
  });

  it('filtra por tipo; sin tiempo dictado no hay ritmo; sin grabaciones está vacío', () => {
    const m = aggregateVoice(range, sessions, 5, 'meeting');
    expect(m.kpis.dictations).toEqual({ value: 0, prev: 0 });
    expect(m.kpis.wpm.value).toBeNull();
    expect(m.apps).toEqual([]);
    expect(aggregateVoice(range, sessions, 5, 'dictation').meetings).toEqual([]);
    expect(isVoiceAnalyticsEmpty(aggregateVoice(range, [], 0))).toBe(true);
  });

  it('con la base: solo las grabaciones propias y sin las que fallaron', async () => {
    const owner = await makeUser('voice-an');
    const other = await makeUser('voice-an-o');
    const mine: VoiceOwner = { workspaceId: owner.id, personId: owner.id };
    const theirs: VoiceOwner = { workspaceId: owner.id, personId: other.id };
    await createSession(mine, { kind: 'meeting', title: 'Mía', status: 'done', durationMs: 20 * 60_000 });
    await createSession(mine, { kind: 'dictation', status: 'done', durationMs: 60_000, text: 'uno dos tres', sourceApp: '/es/app/docs' });
    await createSession(mine, { kind: 'meeting', title: 'Fallida', status: 'error' });
    await createSession(theirs, { kind: 'meeting', title: 'Ajena', status: 'done' });
    const d = await voiceAnalytics(mine, undefined, { days: 7, tz: 'UTC' });
    expect(d.sessionCount).toBe(2);
    expect(d.kpis.meetings.value).toBe(1);
    expect(d.kpis.meetingMinutes.value).toBe(20);
    expect(d.kpis.dictations.value).toBe(1);
    expect(d.meetings.map((m) => m.title)).toEqual(['Mía']);
    expect(d.apps.map((a) => a.app)).toEqual(['docs']);
  });
});
