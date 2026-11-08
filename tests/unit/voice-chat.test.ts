import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createSession, getSessionDetail, saveChunkSegments, saveEnhanced, type VoiceOwner } from '@/lib/voice';
import { setShare } from '@/lib/voice-share';
import { askAcross, askAcrossStream, chatStream, questionKeywords, questionRange } from '@/lib/voice-service';
import { chatInstructions, fakeAnswer } from '@/lib/voice-ai';
import { meetingLabels } from '@/lib/voice-http';
import { seekParam, splitCitations } from '@/lib/voice-cite';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role: string; actingUser?: null; team?: null } }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  isWorkspaceAdmin: (u: { role?: string }) => u?.role === 'owner' || u?.role === 'admin',
  realUserId: (u: { id: string }) => u.id,
}));

const chatRoute = await import('@/app/api/voice/sessions/[id]/chat/route');
const askRoute = await import('@/app/api/voice/ask/route');

beforeEach(() => {
  vi.stubEnv('VOICE_AI_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});
afterEach(() => vi.unstubAllEnvs());

const labels = meetingLabels('en');

async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const a = await makeUser(`${label}-a`);
  const b = await makeUser(`${label}-b`);
  const team = await createTeam(owner.id, `T ${label}`);
  await addMember(team.id, a.id, 'member');
  await addMember(team.id, b.id, 'member');
  const as = (personId: string): VoiceOwner => ({ workspaceId: owner.id, personId });
  return { owner, a, b, as };
}

async function meeting(o: VoiceOwner, title: string, lines: string[], opts: { daysAgo?: number; attendees?: Array<{ name: string; email: string }> } = {}) {
  const row = await createSession(o, { kind: 'meeting', title, status: 'done', attendees: opts.attendees });
  await saveChunkSegments({
    sessionId: row.id,
    source: 'them',
    seq: 0,
    offsetMs: 0,
    durationMs: 60_000,
    pieces: lines.map((text, i) => ({ text, startMs: i * 65_000, endMs: i * 65_000 + 3000, speaker: '' })),
  });
  if (opts.daysAgo !== undefined) {
    const at = new Date(Date.now() - opts.daysAgo * 86_400_000).toISOString();
    await getDb().prepare('UPDATE voice_sessions SET started_at = ?, ended_at = ? WHERE id = ?').run(at, at, row.id);
  }
  return row.id;
}

function jsonReq(body: unknown) {
  return new Request('http://t', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
}

async function ndjson(res: Response): Promise<Array<Record<string, unknown>>> {
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of it) out.push(d);
  return out;
}

describe('citations', () => {
  it('splits [mm:ss], [M1 mm:ss] and [M1] and leaves other brackets as text', () => {
    const parts = splitCitations('Annual billing [03:10]. Also [M2 14:05, 15:00] and [M1]. Not [this] or [99].');
    const cites = parts.filter((p) => p.kind === 'cite');
    expect(cites).toHaveLength(3);
    expect(cites[0]).toMatchObject({ cites: [{ meeting: null, ms: 190_000, time: '03:10' }] });
    expect(cites[1]).toMatchObject({ cites: [{ meeting: 'M2', ms: 845_000 }, { meeting: 'M2', ms: 900_000 }] });
    expect(cites[2]).toMatchObject({ cites: [{ meeting: 'M1', ms: null }] });
    expect(parts.filter((p) => p.kind === 'text').map((p) => (p.kind === 'text' ? p.text : '')).join('')).toContain('Not [this] or [99].');
    // "[M1, 03:10]" es una sola cita.
    expect(splitCitations('[M1, 03:10]')[0]).toMatchObject({ cites: [{ meeting: 'M1', ms: 190_000 }] });
    expect(seekParam('75')).toBe(75_000);
    expect(seekParam('-1')).toBeNull();
    expect(seekParam('1e3')).toBeNull();
  });

  it('asks the model to cite and the fake model cites like it', () => {
    expect(chatInstructions({ across: false, locale: 'en', context: 'x', live: true })).toMatch(/still going on[\s\S]*\[14:05\]/);
    expect(chatInstructions({ across: true, locale: 'es', context: 'x' })).toMatch(/\[M2 14:05\][\s\S]*Spanish/);
    expect(fakeAnswer('billing?', '# Demo\n[01:05] Them: We want annual billing.')).toBe('Them: We want annual billing. [01:05]');
    expect(fakeAnswer('billing?', '# [M1] A (2026-11-01)\n[00:00] Them: hi\n# [M2] B (2026-11-02)\n[02:10] Them: Annual billing.')).toBe('Them: Annual billing. [M2 02:10]');
  });
});

describe('question parsing', () => {
  it('keeps short names and drops time words', () => {
    expect(questionKeywords('What did we agree with Bob last week?')).toEqual(['bob']);
    expect(questionKeywords('¿Qué acordamos con Ana la semana pasada sobre precios?')).toEqual(['ana', 'precios']);
  });

  it('reads date ranges in en, es and pt', () => {
    const now = new Date('2026-11-11T15:00:00Z'); // miércoles
    expect(questionRange('what did we agree last week?', now)).toEqual({ from: '2026-11-02T00:00:00.000Z', to: '2026-11-12T00:00:00.000Z' });
    expect(questionRange('qué hablamos ayer', now)).toEqual({ from: '2026-11-10T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' });
    expect(questionRange('reuniões de hoje', now)).toEqual({ from: '2026-11-11T00:00:00.000Z', to: '2026-11-12T00:00:00.000Z' });
    expect(questionRange('esta semana', now)?.from).toBe('2026-11-09T00:00:00.000Z');
    expect(questionRange('last 3 days', now)?.from).toBe('2026-11-08T00:00:00.000Z');
    expect(questionRange('mês passado', now)?.from).toBe('2026-10-01T00:00:00.000Z');
    expect(questionRange('what about pricing?', now)).toBeNull();
  });
});

describe('chat across meetings', () => {
  it('only uses what the person can see: own meetings plus shares that include them', async () => {
    const ws = await workspace('vchat');
    const outsider = await makeUser('vchat-out');
    const a = ws.as(ws.a.id);
    const b = ws.as(ws.b.id);
    const mineB = await meeting(b, 'Bob sync', ['Zebra launch moves to March.']);
    const sharedA = await meeting(a, 'Zebra pricing', ['Zebra costs ten dollars a seat.']);
    await saveEnhanced(sharedA, { summary: 'Zebra pricing agreed at ten dollars.', sections: [], decisions: [], actionItems: [] });
    const privateA = await meeting(a, 'Zebra secrets', ['Zebra secret plan.']);

    // Sin compartir: B solo ve lo suyo.
    let res = await askAcross({ owner: b, question: 'What about zebra?', locale: 'en', labels, includeShared: true });
    expect(res.meetings.map((m) => m.id)).toEqual([mineB]);

    // A comparte con todo el workspace, sin transcripción.
    const share = await setShare(a, sharedA, { access: 'workspace' });
    if (!share.ok) throw new Error('share');
    res = await askAcross({ owner: b, question: 'What about zebra?', locale: 'en', labels, includeShared: true });
    expect(res.meetings.map((m) => m.id)).toEqual([mineB, share.share.token]);
    expect(res.meetings[1]).toMatchObject({ label: 'M2', href: `/m/${share.share.token}` });
    expect(res.meetings[1].sharedBy).toBeTruthy();
    expect(res.meetings.some((m) => m.id === privateA)).toBe(false);

    // El contexto del compartido no trae la transcripción (no la incluyeron): el fake no puede citar su línea.
    const stream = await askAcrossStream({ owner: b, question: 'Zebra dollars?', locale: 'en', labels, includeShared: true });
    expect(stream.meetings.map((m) => m.label)).toEqual(['M1', 'M2']);
    expect((await collect(stream.deltas!)).join('')).toContain('[M2]');
    const priced = await askAcross({ owner: b, question: 'Zebra dollars?', locale: 'en', labels, includeShared: true });
    expect(priced.answer).not.toContain('a seat');
    expect(priced.answer).toContain('ten dollars');

    // La API y el MCP (sin includeShared) ven solo lo propio.
    expect((await askAcross({ owner: b, question: 'zebra', locale: 'en', labels })).meetings.map((m) => m.id)).toEqual([mineB]);

    // Compartido solo con otra persona: B ya no lo ve; alguien de otro workspace, nunca.
    await setShare(a, sharedA, { access: 'people', people: [ws.owner.id] });
    res = await askAcross({ owner: b, question: 'zebra', locale: 'en', labels, includeShared: true });
    expect(res.meetings.map((m) => m.id)).toEqual([mineB]);
    const out = await askAcross({ owner: { workspaceId: outsider.id, personId: outsider.id }, question: 'zebra', locale: 'en', labels, includeShared: true });
    expect(out.meetings).toEqual([]);
  });

  it('filters by the date in the question and finds people by attendee', async () => {
    const ws = await workspace('vrange');
    const a = ws.as(ws.a.id);
    const old = await meeting(a, 'Kickoff', ['We agreed on the scope.'], { daysAgo: 40, attendees: [{ name: 'Ana Ruiz', email: 'ana@acme.test' }] });
    const recent = await meeting(a, 'Weekly', ['We agreed to ship on Friday.'], { daysAgo: 2, attendees: [{ name: 'Ana Ruiz', email: 'ana@acme.test' }] });
    await meeting(a, 'Other', ['Unrelated talk.'], { daysAgo: 3 });
    const res = await askAcross({ owner: a, question: 'What did we agree with Ana last week?', locale: 'en', labels });
    expect(res.meetings.map((m) => m.id)).toEqual([recent]);
    expect(res.meetings.map((m) => m.id)).not.toContain(old);
    expect(res.answer).toMatch(/\[M1/);
  });
});

describe('streaming chat', () => {
  it('streams a meeting answer in pieces and saves it; two tabs do not overwrite each other', async () => {
    const ws = await workspace('vstream');
    const a = ws.as(ws.a.id);
    const id = await meeting(a, 'Pricing', ['We want annual billing for the whole team next year.']);
    const one = await chatStream({ owner: a, sessionId: id, question: 'What about billing?', locale: 'en', labels });
    const two = await chatStream({ owner: a, sessionId: id, question: 'Anything on billing?', locale: 'en', labels });
    const pieces = await collect(one.deltas);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toContain('[00:00]');
    await one.finish(pieces.join(''));
    await two.finish((await collect(two.deltas)).join(''));
    const d = await getSessionDetail(a, id);
    expect(d?.chat.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    // Otra persona no puede preguntar sobre esta reunión.
    await expect(chatStream({ owner: ws.as(ws.b.id), sessionId: id, question: 'billing?', locale: 'en', labels })).rejects.toThrow('not_found');
  });

  it('routes answer NDJSON with stream: true and keep JSON otherwise', async () => {
    const u = await makeUser('vroute');
    session.user = { id: u.id, email: u.email, role: 'owner', actingUser: null, team: null };
    const id = await meeting({ workspaceId: u.id, personId: u.id }, 'Route call', ['Quokka budget is approved.']);

    const res = await chatRoute.POST(jsonReq({ question: 'quokka budget?', stream: true }), { params: Promise.resolve({ id }) });
    expect(res.headers.get('content-type')).toContain('ndjson');
    const events = await ndjson(res);
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(0);
    const done = events.find((e) => e.type === 'done') as { chat: Array<{ text: string }> };
    expect(done.chat[1].text).toContain('Quokka budget');

    const across = await askRoute.POST(jsonReq({ question: 'quokka?', stream: true, history: [{ role: 'user', text: 'hi' }, { role: 'bad', text: 1 }] }));
    const ev = await ndjson(across);
    expect(ev[0]).toMatchObject({ type: 'meetings' });
    expect((ev[0].meetings as Array<{ id: string }>).map((m) => m.id)).toContain(id);
    expect(ev.at(-1)).toMatchObject({ type: 'done' });

    // Una reunión ajena: 404 antes de abrir el stream.
    const other = await chatRoute.POST(jsonReq({ question: 'x', stream: true }), { params: Promise.resolve({ id: 'nope' }) });
    expect(other.status).toBe(404);

    // Sin IA: el error sale con su status, no a mitad del stream.
    vi.stubEnv('VOICE_AI_FAKE', '');
    vi.stubEnv('AI_ENABLED', 'false');
    const off = await chatRoute.POST(jsonReq({ question: 'quokka?', stream: true }), { params: Promise.resolve({ id }) });
    expect(off.status).toBe(503);
    session.user = null;
  });
});
