import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createContact } from '@/lib/crm';
import { makeUser } from './helpers';
import { coalesceTimeline, computeMetrics, findMentions, resolveSpeakers, toVtt, transcriptLines } from '@/lib/calls/metrics';
import { botSupports, hasExternalAttendee, normalizeMeetUrl, platformOf, shouldJoin, type Speaker, type Utterance } from '@/lib/calls/types';
import { criteriaFor } from '@/lib/calls/methodology';
import { libraryCsv } from '@/lib/calls/export';
import { keywordsOf } from '@/lib/calls/ask';
import { signRequest } from '@/lib/calls/bot';
import { fakeWav } from '@/lib/calls/fake-bot';
import { excludeReason } from '@/lib/mcp/excludes.mjs';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string; role: string; actingUser?: { id: string; email: string; name: string } | null; team?: null; apps?: '*' },
}));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  requireUser: async () => session.user,
  isWorkspaceAdmin: (u: { role?: string }) => u?.role === 'owner' || u?.role === 'admin',
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));

const callsRoute = await import('@/app/api/calls/calls/route');
const callRoute = await import('@/lib/routes/calls/calls/[id]/route');
const commentsRoute = await import('@/lib/routes/calls/calls/[id]/comments/route');
const clipsRoute = await import('@/lib/routes/calls/calls/[id]/clips/route');
const shareRoute = await import('@/lib/routes/calls/calls/[id]/share/route');
const askRoute = await import('@/lib/routes/calls/calls/[id]/ask/route');
const exportRoute = await import('@/lib/routes/calls/calls/[id]/export/route');
const mediaRoute = await import('@/lib/routes/calls/calls/[id]/media/route');
const publicRoute = await import('@/lib/routes/calls/public/[token]/route');
const eventsRoute = await import('@/lib/routes/calls/bot/jobs/[id]/events/route');
const partsRoute = await import('@/lib/routes/calls/bot/jobs/[id]/parts/[kind]/[n]/route');
const askAllRoute = await import('@/app/api/calls/ask/route');
const settingsRoute = await import('@/app/api/calls/settings/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function req(url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url.startsWith('http') ? url : `http://t/${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }) as never;
}

async function asUser(label = 'calls', role = 'owner') {
  const u = await makeUser(label);
  await getDb().prepare("UPDATE users SET name = 'Demo User' WHERE id = ?").run(u.id);
  session.user = { id: u.id, email: u.email, name: 'Demo User', role, actingUser: null, team: null, apps: '*' };
  return u;
}

beforeEach(() => {
  vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
  vi.stubEnv('CALLS_AI_FAKE', '1');
  vi.stubEnv('CALLS_BOT_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});
afterEach(() => {
  vi.unstubAllEnvs();
  session.user = null;
});

describe('calls: meeting links and scheduling rules', () => {
  it('recognizes Meet, Zoom and Teams links and only the bot supports Meet', () => {
    expect(platformOf('https://meet.google.com/abc-defg-hij')).toBe('meet');
    expect(platformOf('https://meet.google.com/abc-defg-hij?authuser=1')).toBe('meet');
    expect(platformOf('https://us02web.zoom.us/j/123456')).toBe('zoom');
    expect(platformOf('https://teams.microsoft.com/l/meetup-join/x')).toBe('teams');
    expect(platformOf('http://meet.google.com/abc-defg-hij')).toBeNull();
    expect(platformOf('https://meet.google.com.evil.test/abc-defg-hij')).toBeNull();
    expect(platformOf('javascript:alert(1)')).toBeNull();
    expect(normalizeMeetUrl('https://meet.google.com/ABC-DEFG-HIJ?pli=1#x')).toBe('https://meet.google.com/abc-defg-hij');
    expect(botSupports('meet')).toBe(true);
    expect(botSupports('zoom')).toBe(false);
  });

  it('tells external meetings apart (free email domains are never the same team)', () => {
    const members = new Set(['ana@acme.com']);
    expect(hasExternalAttendee([{ name: 'Ana', email: 'ana@acme.com' }], 'me@acme.com', members)).toBe(false);
    expect(hasExternalAttendee([{ name: 'Bo', email: 'bo@acme.com' }], 'me@acme.com', members)).toBe(false);
    expect(hasExternalAttendee([{ name: 'Cy', email: 'cy@client.io' }], 'me@acme.com', members)).toBe(true);
    expect(hasExternalAttendee([{ name: 'Di', email: 'di@gmail.com' }], 'me@gmail.com', new Set())).toBe(true);
  });

  it('the per-meeting switch wins over the rule', () => {
    const base = { supported: true, external: true, hasDeal: false };
    expect(shouldJoin({ ...base, rule: 'external', mode: 'auto' })).toBe(true);
    expect(shouldJoin({ ...base, rule: 'deals', mode: 'auto' })).toBe(false);
    expect(shouldJoin({ ...base, rule: 'deals', mode: 'auto', hasDeal: true })).toBe(true);
    expect(shouldJoin({ ...base, rule: 'manual', mode: 'auto' })).toBe(false);
    expect(shouldJoin({ ...base, rule: 'manual', mode: 'on' })).toBe(true);
    expect(shouldJoin({ ...base, rule: 'all', mode: 'off' })).toBe(false);
    expect(shouldJoin({ ...base, supported: false, rule: 'all', mode: 'on' })).toBe(false);
  });
});

describe('calls: transcript, speakers and metrics', () => {
  const timeline = [
    { name: 'Lautaro', startMs: 0, endMs: 4000 },
    { name: 'Lautaro', startMs: 4300, endMs: 9000 },
    { name: 'Ana Pérez', startMs: 9200, endMs: 20000 },
    { name: 'zerosoft Notetaker', startMs: 20000, endMs: 21000 },
    { name: 'Lautaro', startMs: 21000, endMs: 25000 },
  ];
  const pieces = [
    { text: 'Hi Ana, thanks for joining.', startMs: 100, endMs: 3000, speaker: '' },
    { text: 'What tools do you use today?', startMs: 4500, endMs: 8000, speaker: '' },
    { text: 'We use Gong but it is too expensive.', startMs: 9500, endMs: 15000, speaker: '' },
    { text: 'And our CFO decides.', startMs: 15200, endMs: 19500, speaker: '' },
    { text: 'I will send a proposal by Friday.', startMs: 21500, endMs: 24500, speaker: '' },
  ];

  it('coalesces the timeline and names every piece by overlap', () => {
    expect(coalesceTimeline(timeline).filter((e) => e.name === 'Lautaro')).toHaveLength(2);
    const { utterances, speakers } = resolveSpeakers(pieces, timeline, [], { internalNames: ['Lautaro Schiaffino'], botName: 'zerosoft Notetaker', unknownLabel: 'Speaker' });
    expect(speakers.map((s) => [s.name, s.side])).toEqual([
      ['Lautaro', 'internal'],
      ['Ana Pérez', 'external'],
    ]);
    // Los dos tramos seguidos de Ana se unen; el bot no es un hablante.
    expect(utterances).toHaveLength(4);
    expect(utterances[2].t).toBe('We use Gong but it is too expensive. And our CFO decides.');
  });

  it('falls back to provider labels, then to Meet captions', () => {
    const labelled = resolveSpeakers([{ text: 'Hola', startMs: 0, endMs: 1000, speaker: '1' }], [], [], { internalNames: [], botName: 'Bot', unknownLabel: 'Speaker' });
    expect(labelled.speakers[0].name).toBe('Speaker 2');
    const caps = resolveSpeakers([], [], [{ speaker: 'Ana', text: 'Hola', startMs: 500 }, { speaker: 'Bot', text: 'Recording', startMs: 600 }], { internalNames: [], botName: 'Bot', unknownLabel: 'Speaker' });
    expect(caps.utterances).toHaveLength(1);
    expect(caps.speakers[0].name).toBe('Ana');
  });

  it('computes talk ratio, monologues, patience and questions', () => {
    const speakers: Speaker[] = [
      { id: 's1', name: 'Rep', side: 'internal' },
      { id: 's2', name: 'Buyer', side: 'external' },
    ];
    const u: Utterance[] = [
      { s: 's1', t: 'How do you sell today?', a: 0, b: 10_000 },
      { s: 's2', t: 'Mostly by phone.', a: 12_000, b: 42_000 },
      { s: 's1', t: 'Got it.', a: 43_000, b: 48_000 },
    ];
    const m = computeMetrics(u, speakers);
    expect(m.talkMs).toBe(45_000);
    expect(m.talkRatio).toBeCloseTo(15 / 45);
    expect(m.longestMonologue).toEqual({ speakerId: 's1', ms: 10_000, startMs: 0 });
    expect(m.longestCustomerStory?.ms).toBe(30_000);
    expect(m.patienceMs).toBe(1000);
    expect(m.questionsInternal).toBe(1);
    expect(m.interactivity).toBeGreaterThan(0);
  });

  it('finds competitor mentions as whole words and exports VTT and text', () => {
    const u: Utterance[] = [{ s: 's1', t: 'We tried Gong and gongs.', a: 1000, b: 2000 }];
    expect(findMentions(u, ['Gong']).map((m) => m.atMs)).toEqual([1000]);
    expect(findMentions(u, ['ong'])).toHaveLength(0);
    const sp: Speaker[] = [{ id: 's1', name: '<Ana>', side: 'external' }];
    expect(toVtt(u, sp)).toContain('<v &lt;Ana&gt;>We tried Gong and gongs.');
    expect(transcriptLines(u, sp)[0]).toBe('[0:01] <Ana>: We tried Gong and gongs.');
  });

  it('builds custom scorecard criteria and keeps CSV cells safe', () => {
    expect(criteriaFor('spiced', []).map((c) => c.key)).toEqual(['situation', 'pain', 'impact', 'critical_event', 'decision']);
    expect(criteriaFor('custom', ['  Budget ', '', 'Timing']).map((c) => c.key)).toEqual(['c1', 'c2']);
    const csv = libraryCsv([
      { id: 'c', title: '=HYPERLINK("x")', status: 'ready', platform: 'meet', source: 'bot', ownerId: 'o', ownerName: 'A, B', at: '2026-11-08', durationMs: 120_000, deal: null, speakers: 2, talkRatio: 0.5, summary: 'ok', error: null },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"A, B"');
    expect(keywordsOf('¿Qué dijeron sobre el precio de Gong?')).toEqual(['dijeron', 'precio', 'gong']);
  });

  it('signs bot requests with HMAC over timestamp, method, path and body', () => {
    const h = signRequest('s'.repeat(40), 'post', '/v1/jobs', '{"a":1}', 1700000000);
    expect(h['x-zs-timestamp']).toBe('1700000000');
    expect(h['x-zs-signature']).toBe(`sha256=${createHmac('sha256', 's'.repeat(40)).update('1700000000.POST /v1/jobs.{"a":1}').digest('hex')}`);
  });

  it('keeps the bot and binary routes out of MCP', () => {
    expect(excludeReason('/api/calls/bot/jobs/[id]/events', 'POST')).toBeTruthy();
    expect(excludeReason('/api/calls/calls/[id]/media', 'GET')).toBeTruthy();
    expect(excludeReason('/api/calls/public/[token]', 'GET')).toBeTruthy();
    expect(excludeReason('/api/calls/calls', 'GET')).toBeFalsy();
  });
});

describe('calls: end to end with the fake bot', () => {
  async function sendBot(title = 'Discovery with Acme') {
    const res = await callsRoute.POST(req('http://t/api/calls/calls', 'POST', { meetingUrl: 'https://meet.google.com/abc-defg-hij', title }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { call: { id: string } }).call.id;
  }

  it('records, transcribes, analyzes and lists a call; comments, clips, share, export and delete', async () => {
    const u = await asUser();
    const id = await sendBot();
    const detail = (await (await callRoute.GET(req(`http://t/api/calls/calls/${id}`), ctx(id))).json()) as { call: { status: string; transcript: Utterance[]; speakers: Speaker[]; analysis: { summary: string; nextSteps: unknown[]; competitors: Array<{ name: string }> }; metrics: { talkRatio: number } } };
    expect(detail.call.status).toBe('ready');
    expect(detail.call.speakers.map((s) => s.name)).toEqual(['Demo User', 'Ana Prospect']);
    expect(detail.call.speakers[0].side).toBe('internal');
    expect(detail.call.transcript.length).toBeGreaterThan(3);
    expect(detail.call.analysis.summary).toBeTruthy();
    expect(detail.call.analysis.competitors.map((c) => c.name)).toContain('Gong');
    expect(detail.call.metrics.talkRatio).toBeGreaterThan(0);

    // Biblioteca y búsqueda en lo que se dijo.
    const list = (await (await callsRoute.GET(new NextRequest('http://t/api/calls/calls?q=CFO'))).json()) as { calls: Array<{ id: string }> };
    expect(list.calls.map((c) => c.id)).toEqual([id]);
    const none = (await (await callsRoute.GET(new NextRequest('http://t/api/calls/calls?q=nothing-like-this'))).json()) as { calls: unknown[] };
    expect(none.calls).toHaveLength(0);

    // Media por rangos.
    const media = await mediaRoute.GET(new Request(`http://t/api/calls/calls/${id}/media`, { headers: { range: 'bytes=0-99' } }) as never, ctx(id));
    expect(media.status).toBe(206);
    expect(media.headers.get('content-type')).toBe('audio/wav');
    expect((await media.arrayBuffer()).byteLength).toBe(100);

    // Renombrar.
    const renamed = await callRoute.PATCH(req(`http://t/api/calls/calls/${id}`, 'PATCH', { title: 'Acme · pricing' }), ctx(id));
    expect(((await renamed.json()) as { call: { title: string } }).call.title).toBe('Acme · pricing');

    // Comentario con momento y clip.
    expect((await commentsRoute.POST(req('x', 'POST', { body: 'Great question here', atMs: 2000 }), ctx(id))).status).toBe(201);
    expect((await clipsRoute.POST(req('x', 'POST', { title: 'Pricing', startMs: 1000, endMs: 500 }), ctx(id))).status).toBe(400);
    expect((await clipsRoute.POST(req('x', 'POST', { title: 'Pricing', startMs: 1000, endMs: 6000 }), ctx(id))).status).toBe(201);

    // Preguntas sobre la llamada y sobre todas.
    const ans = (await (await askRoute.POST(req('x', 'POST', { question: 'Who signs the contract?' }), ctx(id))).json()) as { answer: string };
    expect(ans.answer).toContain('CFO');
    const all = (await (await askAllRoute.POST(req('x', 'POST', { question: 'What about the CFO?' }))).json()) as { sources: Array<{ id: string }> };
    expect(all.sources.map((s) => s.id)).toEqual([id]);

    // Link público: solo lo que corresponde, y se corta al apagarlo.
    const token = ((await (await shareRoute.POST(req('x', 'POST'), ctx(id))).json()) as { token: string }).token;
    const pub = (await (await publicRoute.GET(req('x') as never, { params: Promise.resolve({ token }) })).json()) as { call: Record<string, unknown> };
    expect(pub.call.title).toBe('Acme · pricing');
    expect(pub.call).not.toHaveProperty('comments');
    expect(pub.call).not.toHaveProperty('analysis');
    await shareRoute.DELETE(req('x', 'DELETE'), ctx(id));
    expect((await publicRoute.GET(req('x') as never, { params: Promise.resolve({ token }) })).status).toBe(404);

    // Export.
    const md = await exportRoute.GET(new NextRequest(`http://t/api/calls/calls/${id}/export?format=md&locale=en`), ctx(id));
    expect(md.headers.get('content-type')).toContain('text/markdown');
    expect(await md.text()).toContain('## Transcript');

    // Webhook de la suite y aviso: la actividad no se loguea sin contacto ni deal.
    const row = (await getDb().prepare('SELECT crm_activity_id FROM calls WHERE id = ?').get(id)) as { crm_activity_id: string | null };
    expect(row.crm_activity_id).toBeNull();
    const notes = (await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'calls_activity'").get(u.id)) as { n: number };
    expect(Number(notes.n)).toBeGreaterThan(0);

    // Borrar.
    expect((await callRoute.DELETE(req('x', 'DELETE'), ctx(id))).status).toBe(200);
    expect((await callRoute.GET(req('x'), ctx(id))).status).toBe(404);
    const parts = (await getDb().prepare('SELECT COUNT(*) AS n FROM calls_parts WHERE call_id = ?').get(id)) as { n: number };
    expect(Number(parts.n)).toBe(0);
  });

  it('links the call to the open deal of an attendee and logs one meeting on it', async () => {
    const u = await asUser('callscrm');
    const contact = await createContact(u.id, { firstName: 'Ana', lastName: 'Prospect', email: 'ana@client.io' } as never);
    const db = getDb();
    await db.prepare("INSERT INTO crm_deals (id, user_id, pipeline_id, stage_id, name) VALUES (?, ?, 'p', 's', 'Acme renewal')").run(`deal-${u.id}`, u.id);
    await db.prepare('INSERT INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)').run(`deal-${u.id}`, contact.id);
    const { sendBotNow } = await import('@/lib/calls/schedule');
    const { callsActorOf } = await import('@/lib/calls/actor');
    // La reunión viene del calendario con su invitado: se simula guardando los asistentes antes del bot.
    vi.stubEnv('CALLS_BOT_FAKE', '0');
    vi.stubEnv('CALLS_BOT_URL', '');
    await expect(sendBotNow(callsActorOf(session.user as never), { url: 'https://meet.google.com/abc-defg-hij' })).rejects.toMatchObject({ code: 'bot_not_configured' });
    vi.stubEnv('CALLS_BOT_FAKE', '1');
    const id = `call_t_${u.id}`;
    const ts = new Date().toISOString();
    await db
      .prepare("INSERT INTO calls (id, workspace_id, owner_id, title, source, platform, meeting_url, status, attendees, created_at, updated_at) VALUES (?, ?, ?, 'Renewal', 'bot', 'meet', 'https://meet.google.com/abc-defg-hij', 'queued', ?, ?, ?)")
      .run(id, u.id, u.id, JSON.stringify([{ name: 'Ana', email: 'ANA@client.io' }]), ts, ts);
    const { dispatchCall } = await import('@/lib/calls/bot');
    expect(await dispatchCall(id)).toBe('sent');
    const row = (await db.prepare('SELECT status, deal_id, contact_ids, crm_activity_id FROM calls WHERE id = ?').get(id)) as { status: string; deal_id: string; contact_ids: string; crm_activity_id: string };
    expect(row.status).toBe('ready');
    expect(row.deal_id).toBe(`deal-${u.id}`);
    expect(JSON.parse(row.contact_ids)).toEqual([contact.id]);
    const act = (await db.prepare('SELECT type, deal_id, contact_id, body FROM crm_activities WHERE id = ?').get(row.crm_activity_id)) as { type: string; deal_id: string; contact_id: string; body: string };
    expect(act).toMatchObject({ type: 'meeting', deal_id: `deal-${u.id}`, contact_id: contact.id });
    expect(act.body).toContain(`/app/calls/call/${id}`);
    // Despachar de nuevo no duplica nada.
    expect(await dispatchCall(id)).toBe('skipped');
    const { dealsOverview } = await import('@/lib/calls/crm');
    const deals = await dealsOverview(callsActorOf(session.user as never), null);
    expect(deals.map((d) => d.id)).toEqual([`deal-${u.id}`]);
    expect(deals[0].risks).toContain('competitor');
  });

  it('accepts bot callbacks only with the job token, and only while the job lives', async () => {
    const u = await asUser('callsbot');
    const db = getDb();
    const id = `call_b_${u.id}`;
    const ts = new Date().toISOString();
    const { hashToken } = await import('@/lib/calls/types');
    const token = 'tok_' + 'a'.repeat(40);
    await db
      .prepare("INSERT INTO calls (id, workspace_id, owner_id, title, status, meeting_url, bot_token_hash, created_at, updated_at) VALUES (?, ?, ?, 'Bot', 'joining', 'https://meet.google.com/abc-defg-hij', ?, ?, ?)")
      .run(id, u.id, u.id, hashToken(token), ts, ts);
    session.user = null;
    const ev = (auth?: string, body: unknown = { type: 'recording', at: ts }) => eventsRoute.POST(req('x', 'POST', body, auth ? { authorization: `Bearer ${auth}` } : {}), ctx(id));
    expect((await ev()).status).toBe(401);
    expect((await ev('tok_' + 'b'.repeat(40))).status).toBe(401);
    expect((await ev(token)).status).toBe(200);
    const wav = fakeWav(1000);
    const put = (kind: string, n: string, bytes: Buffer, auth = token) =>
      partsRoute.PUT(new Request('http://t/x', { method: 'PUT', body: new Uint8Array(bytes), headers: { authorization: `Bearer ${auth}`, 'content-type': 'audio/wav', 'x-segment-start-ms': '0' } }) as never, { params: Promise.resolve({ id, kind, n }) });
    expect((await put('video', '0', wav)).status).toBe(200);
    expect((await put('other', '0', wav)).status).toBe(404);
    expect((await put('audio', '99999', wav)).status).toBe(400);
    const { completeBotJob } = await import('@/lib/calls/bot');
    const { getCallById } = await import('@/lib/calls/core');
    // Tamaño que no coincide: no hay video ni audio que sirva, la llamada falla.
    await completeBotJob((await getCallById(id))!, { durationMs: 1000, video: { parts: 1, bytes: wav.length + 5, mime: 'audio/wav' }, audio: null });
    const failed = (await db.prepare('SELECT status, error, bot_token_hash FROM calls WHERE id = ?').get(id)) as { status: string; error: string; bot_token_hash: string | null };
    expect(failed).toMatchObject({ status: 'failed', error: 'upload_incomplete', bot_token_hash: null });
    // Con el trabajo cerrado, el token ya no sirve.
    expect((await ev(token)).status).toBe(401);
  });

  it('members only see team calls when visibility is team, and only admins change settings', async () => {
    const owner = await asUser('callsvis');
    const id = await sendBot('Private one');
    const member = await makeUser('callsmember');
    const db = getDb();
    const teamId = `team-${owner.id}`;
    await db.prepare("INSERT INTO teams (id, owner_id, name, keyed_by) VALUES (?, ?, 'T', 'owner')").run(teamId, owner.id).catch(() => undefined);
    await db.prepare("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')").run(teamId, member.id).catch(() => undefined);
    // Como miembro del workspace del owner.
    session.user = { id: owner.id, email: member.email, name: 'Member', role: 'member', actingUser: { id: member.id, email: member.email, name: 'Member' }, team: null, apps: '*' };
    expect((await callRoute.GET(req('x'), ctx(id))).status).toBe(200);
    expect((await callRoute.DELETE(req('x', 'DELETE'), ctx(id))).status).toBe(403);
    expect((await settingsRoute.PUT(req('x', 'PUT', { visibility: 'private' }))).status).toBe(403);
    session.user = { id: owner.id, email: owner.email, name: 'Owner', role: 'owner', actingUser: null, team: null, apps: '*' };
    expect((await settingsRoute.PUT(req('x', 'PUT', { visibility: 'private', competitors: ['Chorus'] }))).status).toBe(200);
    session.user = { id: owner.id, email: member.email, name: 'Member', role: 'member', actingUser: { id: member.id, email: member.email, name: 'Member' }, team: null, apps: '*' };
    expect((await callRoute.GET(req('x'), ctx(id))).status).toBe(404);
    const list = (await (await callsRoute.GET(new NextRequest('http://t/api/calls/calls'))).json()) as { calls: unknown[] };
    expect(list.calls).toHaveLength(0);
  });

  it('does not send the bot while Calls is turned off for the workspace', async () => {
    const u = await asUser('callsoff');
    const db = getDb();
    const { saveWorkspaceAppRule } = await import('@/lib/workspace-apps');
    const { callsBlockedFor, dispatchCall } = await import('@/lib/calls/bot');
    const queue = async (id: string) => {
      const ts = new Date().toISOString();
      await db
        .prepare("INSERT INTO calls (id, workspace_id, owner_id, title, source, platform, meeting_url, status, will_join, created_at, updated_at) VALUES (?, ?, ?, 'Weekly', 'bot', 'meet', 'https://meet.google.com/abc-defg-hij', 'queued', 1, ?, ?)")
        .run(id, u.id, u.id, ts, ts);
    };
    await saveWorkspaceAppRule(u.id, 'calls', { mode: 'off', people: [], teams: [], denied: [] }, u.id);
    expect(await callsBlockedFor(u.id, u.id)).toBe(true);
    await queue(`call_off_${u.id}`);
    expect(await dispatchCall(`call_off_${u.id}`)).toBe('skipped');
    const off = (await db.prepare('SELECT status, will_join FROM calls WHERE id = ?').get(`call_off_${u.id}`)) as { status: string; will_join: number };
    expect(off).toMatchObject({ status: 'cancelled', will_join: 0 });
    // Prendida de nuevo, el bot vuelve a entrar.
    await saveWorkspaceAppRule(u.id, 'calls', { mode: 'all', people: [], teams: [], denied: [] }, u.id);
    expect(await callsBlockedFor(u.id, u.id)).toBe(false);
    await queue(`call_on_${u.id}`);
    expect(await dispatchCall(`call_on_${u.id}`)).toBe('sent');
  });

  it('rejects links that are not Google Meet', async () => {
    await asUser('callsurl');
    const bad = await callsRoute.POST(req('x', 'POST', { meetingUrl: 'https://evil.test/abc-defg-hij' }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_meeting_url');
    const zoom = await callsRoute.POST(req('x', 'POST', { meetingUrl: 'https://zoom.us/j/123' }));
    expect(((await zoom.json()) as { error: string }).error).toBe('unsupported_platform');
  });
});
