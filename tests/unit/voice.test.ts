import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import { createContact } from '@/lib/crm';
import { createProject } from '@/lib/track-data';
import { FAKE_DICTATION } from '@/lib/voice-transcribe';
import { ruleCleanup } from '@/lib/voice-cleanup';
import { isVoiceBlobUrl, voiceBlobPrefix } from '@/lib/voice-blob';
import { questionKeywords } from '@/lib/voice-service';
import { meetingMarkdown } from '@/lib/voice-integrations';
import { normalizeSettings } from '@/lib/voice';
import type { VoiceSessionDetail } from '@/lib/voice-types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; role: string; actingUser?: { id: string } | null; team?: null },
}));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  isWorkspaceAdmin: (u: { role?: string }) => u?.role === 'owner' || u?.role === 'admin',
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));

const dictateRoute = await import('@/app/api/voice/dictate/route');
const sessionsRoute = await import('@/app/api/voice/sessions/route');
const sessionRoute = await import('@/lib/routes/voice/sessions/[id]/route');
const chunksRoute = await import('@/app/api/voice/sessions/[id]/chunks/route');
const enhanceRoute = await import('@/app/api/voice/sessions/[id]/enhance/route');
const chatRoute = await import('@/app/api/voice/sessions/[id]/chat/route');
const sendRoute = await import('@/lib/routes/voice/sessions/[id]/send/route');
const askRoute = await import('@/app/api/voice/ask/route');
const dictionaryRoute = await import('@/app/api/voice/dictionary/route');
const dictionaryItemRoute = await import('@/lib/routes/voice/dictionary/[id]/route');
const settingsRoute = await import('@/app/api/voice/settings/route');
const templatesRoute = await import('@/app/api/voice/templates/route');
const v1Dictate = await import('@/app/api/v1/voice/dictate/route');
const v1Sessions = await import('@/app/api/v1/voice/sessions/route');
const v1Chunks = await import('@/app/api/v1/voice/sessions/[id]/chunks/route');
const v1Session = await import('@/lib/routes/v1/voice/sessions/[id]/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

function audioReq(url: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}, bytes = 2048) {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(bytes).fill(7)], { type: 'audio/webm' }), 'a.webm');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request(url, { method: 'POST', body: form, headers }) as never;
}

async function asUser(label = 'voice') {
  const u = await makeUser(label);
  session.user = { id: u.id, email: u.email, role: 'owner', actingUser: null, team: null };
  return u;
}

async function newMeeting(title = 'Acme pricing call'): Promise<string> {
  const res = await sessionsRoute.POST(jsonReq('http://t/api/voice/sessions', 'POST', { title }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function chunk(id: string, source: string, seq: number, offsetMs = 0) {
  return chunksRoute.POST(audioReq(`http://t/api/voice/sessions/${id}/chunks`, { source, seq: String(seq), offsetMs: String(offsetMs), durationMs: '20000', recorderId: 'tab-aaaaaaaa' }), ctx(id));
}

beforeEach(() => {
  vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
  vi.stubEnv('VOICE_AI_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});
afterEach(() => {
  vi.unstubAllEnvs();
  session.user = null;
});

describe('voice dictation', () => {
  it('transcribes, cleans up and saves to the history, measuring usage', async () => {
    const u = await asUser();
    const res = await dictateRoute.POST(audioReq('http://t/api/voice/dictate', { context: 'chat', durationMs: '4000' }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { text: string; raw: string; ai: boolean; session: { id: string; words: number } };
    expect(data.raw).toBe(FAKE_DICTATION);
    expect(data.ai).toBe(true);
    expect(data.text).toContain('Tuesday'.toLowerCase());
    expect(data.text).not.toMatch(/\bum\b/);
    expect(data.text).toContain('1. The landing');
    expect(data.session.words).toBeGreaterThan(5);
    const usage = (await getDb().prepare('SELECT feature FROM ai_usage WHERE user_id = ? ORDER BY feature').all(u.id)) as Array<{ feature: string }>;
    expect(usage.map((r) => r.feature)).toEqual(['voice_cleanup', 'voice_transcribe']);
    const list = await sessionsRoute.GET(new Request('http://t/api/voice/sessions?kind=dictation') as never);
    expect(((await list.json()) as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it('applies dictionary replacements and falls back to rules without AI', async () => {
    await asUser();
    const add = await dictionaryRoute.POST(jsonReq('http://t', 'POST', { kind: 'replace', phrase: 'the demo', replacement: 'the Acme demo' }));
    expect(add.status).toBe(201);
    const dup = await dictionaryRoute.POST(jsonReq('http://t', 'POST', { kind: 'replace', phrase: 'THE DEMO', replacement: 'x' }));
    expect(dup.status).toBe(409);
    vi.stubEnv('VOICE_AI_FAKE', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    const res = await dictateRoute.POST(audioReq('http://t/api/voice/dictate', {}));
    const data = (await res.json()) as { text: string; ai: boolean; aiError: string | null };
    expect(res.status).toBe(201);
    expect(data.ai).toBe(false);
    expect(data.aiError).toBe('ai_disabled');
    expect(data.text).toContain('The Acme demo');
    const entry = (await add.json()) as { id: string };
    expect((await dictionaryItemRoute.DELETE(new Request('http://t') as never, ctx(entry.id))).status).toBe(200);
  });

  it('says ai_disabled when the gateway provider has no credentials', async () => {
    await asUser();
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    const res = await dictateRoute.POST(audioReq('http://t/api/voice/dictate'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_disabled' });
  });

  it('rejects other types and oversized audio', async () => {
    await asUser();
    const form = new FormData();
    form.append('audio', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'a.svg');
    const bad = await dictateRoute.POST(new Request('http://t', { method: 'POST', body: form }) as never);
    expect(bad.status).toBe(400);
    const big = await dictateRoute.POST(audioReq('http://t', {}, {}, 4 * 1024 * 1024 + 10));
    expect(big.status).toBe(413);
  });
});

describe('voice meetings', () => {
  it('ingests chunks idempotently with speakers and searches the transcript', async () => {
    await asUser();
    const id = await newMeeting();
    const me = await chunk(id, 'me', 0);
    expect(me.status).toBe(201);
    const them = await chunk(id, 'them', 0);
    const themData = (await them.json()) as { segments: Array<{ speaker: string; source: string }> };
    expect(themData.segments.length).toBeGreaterThan(1);
    expect(new Set(themData.segments.map((s) => s.speaker))).toEqual(new Set(['0', '1']));
    const again = await chunk(id, 'them', 0);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
    const next = await chunk(id, 'me', 200, 20_000);
    const nextSegs = ((await next.json()) as { segments: Array<{ startMs: number }> }).segments;
    expect(nextSegs[0].startMs).toBeGreaterThanOrEqual(20_000);

    const detail = (await (await sessionRoute.GET(new Request('http://t') as never, ctx(id))).json()) as VoiceSessionDetail;
    expect(detail.segments.filter((s) => s.source === 'me')).toHaveLength(2);
    expect(detail.durationMs).toBeGreaterThanOrEqual(40_000);

    const search = await sessionsRoute.GET(new Request('http://t/api/voice/sessions?kind=meeting&q=annual') as never);
    const found = ((await search.json()) as { sessions: Array<{ id: string; match?: string }> }).sessions;
    expect(found.map((s) => s.id)).toEqual([id]);
    expect(found[0].match).toContain('annual');
  });

  it('keeps meetings private to the person who recorded them', async () => {
    const owner = await asUser();
    const id = await newMeeting();
    const teammate = await makeUser('mate');
    session.user = { id: owner.id, email: teammate.email, role: 'member', actingUser: { id: teammate.id }, team: null };
    expect((await sessionRoute.GET(new Request('http://t') as never, ctx(id))).status).toBe(404);
    expect((await chunk(id, 'me', 0)).status).toBe(404);
    expect((await sessionRoute.DELETE(new Request('http://t') as never, ctx(id))).status).toBe(404);
  });

  it('enhances notes with the template, logs to the contact and answers questions', async () => {
    const u = await asUser();
    const contact = await createContact(u.id, { email: 'ana@acme.test', firstName: 'Ana' });
    const id = await newMeeting();
    await chunk(id, 'me', 0);
    await chunk(id, 'them', 0);
    const patch = await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { myNotes: 'Pricing per seat\nAnnual billing?', contactId: contact.id, templateKey: 'sales', speakers: { 'them:1': 'Ana' } }), ctx(id));
    expect(patch.status).toBe(200);

    const res = await enhanceRoute.POST(jsonReq('http://t', 'POST', { locale: 'en' }), ctx(id));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { enhanced: VoiceSessionDetail['enhanced']; crmActivityId: string };
    expect(data.enhanced?.sections[0].heading).toBe('Context and pain');
    expect(data.enhanced?.sections[0].points.filter((p) => p.source === 'mine').map((p) => p.text)).toEqual(['Pricing per seat', 'Annual billing?']);
    expect(data.enhanced?.decisions.join(' ')).toMatch(/decide|agree/i);
    expect(data.enhanced?.actionItems.some((a) => /contract/i.test(a.text))).toBe(true);
    const act = (await getDb().prepare('SELECT type, contact_id, body FROM crm_activities WHERE id = ?').get(data.crmActivityId)) as { type: string; contact_id: string; body: string };
    expect(act.type).toBe('meeting');
    expect(act.contact_id).toBe(contact.id);
    // Texto plano (el timeline del CRM no renderiza Markdown).
    expect(act.body).toMatch(/^Summary\n/);
    expect(act.body).not.toContain('##');
    // Regenerar actualiza la misma actividad.
    const again = (await (await enhanceRoute.POST(jsonReq('http://t', 'POST', {}), ctx(id))).json()) as { crmActivityId: string };
    expect(again.crmActivityId).toBe(data.crmActivityId);

    const chat = await chatRoute.POST(jsonReq('http://t', 'POST', { question: 'What did Ana say about billing?' }), ctx(id));
    const messages = ((await chat.json()) as { chat: Array<{ role: string; text: string }> }).chat;
    expect(messages).toHaveLength(2);
    expect(messages[1].text).toContain('Ana');
    expect(messages[1].text.toLowerCase()).toContain('billing');

    const ask = await askRoute.POST(jsonReq('http://t', 'POST', { question: 'Who wants annual billing?' }));
    const across = (await ask.json()) as { answer: string; meetings: Array<{ id: string }> };
    expect(across.meetings.map((m) => m.id)).toContain(id);
    expect(across.answer.toLowerCase()).toContain('annual');
  });

  it('sends notes to Docs, Notes, Track issues and CRM tasks', async () => {
    const u = await asUser();
    const id = await newMeeting('Weekly sync');
    await chunk(id, 'them', 0);
    await enhanceRoute.POST(jsonReq('http://t', 'POST', {}), ctx(id));
    // Docs la ve todo el workspace: sin transcripción salvo que se pida.
    const docs = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'docs' }), ctx(id));
    expect(docs.status).toBe(201);
    const page = (await getDb().prepare('SELECT title, content FROM docs_pages WHERE id = ?').get(((await docs.json()) as { id: string }).id)) as { title: string; content: string };
    expect(page.title).toBe('Weekly sync');
    expect(page.content).not.toContain('Transcript');
    expect(page.content).toContain('Summary');
    // Va al teamspace privado de la persona (Docs D3): ni los admins la ven hasta que la comparta.
    const ts = (await getDb()
      .prepare('SELECT t.access, t.name FROM docs_pages p JOIN docs_teamspaces t ON t.id = p.teamspace_id WHERE p.title = ? ORDER BY p.created_at DESC LIMIT 1')
      .get('Weekly sync')) as { access: string; name: string };
    expect(ts).toEqual({ access: 'private', name: 'Voice meetings' });
    const withT = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'docs', includeTranscript: true }), ctx(id));
    const page2 = (await getDb().prepare('SELECT content FROM docs_pages WHERE id = ?').get(((await withT.json()) as { id: string }).id)) as { content: string };
    expect(page2.content).toContain('Transcript');
    const notes = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'notes' }), ctx(id));
    expect(notes.status).toBe(201);
    const md = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'markdown' }), ctx(id));
    expect(((await md.json()) as { markdown: string }).markdown).toMatch(/^# Weekly sync/);

    const project = await createProject(u.id, null, { name: 'Launch' } as Parameters<typeof createProject>[2]);
    const foreign = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'track', projectId: 'nope', items: ['x'] }), ctx(id));
    expect(foreign.status).toBe(404);
    const track = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'track', projectId: project.id, items: ['Send the contract'] }), ctx(id));
    expect(track.status).toBe(201);
    const issue = (await getDb().prepare('SELECT title FROM track_issues WHERE project_id = ?').get(project.id)) as { title: string };
    expect(issue.title).toBe('Send the contract');
    const crm = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'crm', items: ['Call Ana', 'Send quote'] }), ctx(id));
    expect(((await crm.json()) as { created: unknown[] }).created).toHaveLength(2);
    // Un segundo envío devuelve lo ya creado (no duplica tareas).
    const again = (await (await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'crm', items: ['Call Ana'] }), ctx(id))).json()) as { already: boolean; created: unknown[] };
    expect(again.already).toBe(true);
    expect(again.created).toHaveLength(2);
    const tasks = (await getDb().prepare("SELECT COUNT(*) AS n FROM crm_activities WHERE user_id = ? AND type = 'task'").get(u.id)) as { n: number };
    expect(Number(tasks.n)).toBe(2);
    const contactLog = await sendRoute.POST(jsonReq('http://t', 'POST', { target: 'contact' }), ctx(id));
    expect(contactLog.status).toBe(404);
  });

  it('shows ai_disabled for notes when the AI is off', async () => {
    await asUser();
    const id = await newMeeting();
    await chunk(id, 'me', 0);
    vi.stubEnv('VOICE_AI_FAKE', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    const res = await enhanceRoute.POST(jsonReq('http://t', 'POST', {}), ctx(id));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_disabled' });
  });

  it('saves settings and templates', async () => {
    await asUser();
    const res = await settingsRoute.PATCH(jsonReq('http://t', 'PATCH', { shortcut: 'Alt+D', styles: { email: 'casual' }, showBar: false }));
    const data = (await res.json()) as { settings: { shortcut: string; styles: Record<string, string>; showBar: boolean } };
    expect(data.settings.shortcut).toBe('Alt+D');
    expect(data.settings.styles.email).toBe('casual');
    expect(data.settings.styles.chat).toBe('casual');
    expect(data.settings.showBar).toBe(false);
    expect((await settingsRoute.PATCH(jsonReq('http://t', 'PATCH', { shortcut: 'Ctrl+Q' }))).status).toBe(400);
    const tpl = await templatesRoute.POST(jsonReq('http://t', 'POST', { name: 'Board meeting', instructions: 'Metrics\nRisks' }));
    expect(tpl.status).toBe(201);
    expect(normalizeSettings({ language: 'xx-yy', styles: { email: 'loud' } }).language).toBe('auto');
  });
});

describe('voice API v1', () => {
  it('needs voice scopes and works for the desktop flow', async () => {
    const u = await makeUser('desk');
    const readOnly = await createApiKey(u.id, 'read', u.id, ['voice:read']);
    const denied = await v1Dictate.POST(audioReq('http://t/api/v1/voice/dictate', {}, { authorization: `Bearer ${readOnly.key}` }));
    expect(denied.status).toBe(403);

    const key = await createApiKey(u.id, 'desktop', u.id, ['voice:read', 'voice:write']);
    const auth = { authorization: `Bearer ${key.key}` };
    const dict = await v1Dictate.POST(audioReq('http://t/api/v1/voice/dictate', { context: 'email' }, auth));
    expect(dict.status).toBe(201);
    expect(((await dict.json()) as { data: { text: string } }).data.text).toBe(ruleCleanup(FAKE_DICTATION));

    const created = await v1Sessions.POST(jsonReq('http://t/api/v1/voice/sessions', 'POST', { title: 'Zoom call' }, auth));
    const sid = ((await created.json()) as { data: { id: string } }).data.id;
    const up = await v1Chunks.POST(audioReq(`http://t/api/v1/voice/sessions/${sid}/chunks`, { source: 'them', seq: '0', offsetMs: '0', durationMs: '20000' }, auth), ctx(sid));
    expect(up.status).toBe(201);
    const done = await v1Session.PATCH(jsonReq('http://t', 'PATCH', { status: 'done' }, auth), ctx(sid));
    expect(((await done.json()) as { data: { status: string } }).data.status).toBe('done');
    const list = await v1Sessions.GET(new Request('http://t/api/v1/voice/sessions?kind=meeting', { headers: auth }) as never);
    const rows = ((await list.json()) as { data: Array<{ id: string; capture: string }> }).data;
    expect(rows.map((r) => r.id)).toEqual([sid]);
    expect(rows[0].capture).toBe('desktop');
    const bad = await v1Chunks.POST(audioReq(`http://t/api/v1/voice/sessions/${sid}/chunks`, { source: 'aliens', seq: '0' }, auth), ctx(sid));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_input');
  });
});

describe('voice helpers', () => {
  it('only accepts Blob URLs under the person prefix', () => {
    const prefix = voiceBlobPrefix('user-1');
    expect(isVoiceBlobUrl(`https://abc123.public.blob.vercel-storage.com/${prefix}rec-x.webm`, 'user-1')).toBe(true);
    expect(isVoiceBlobUrl(`https://abc123.public.blob.vercel-storage.com/${voiceBlobPrefix('user-2')}rec.webm`, 'user-1')).toBe(false);
    expect(isVoiceBlobUrl(`https://evil.example.com/${prefix}rec.webm`, 'user-1')).toBe(false);
    expect(isVoiceBlobUrl(`http://abc123.public.blob.vercel-storage.com/${prefix}rec.webm`, 'user-1')).toBe(false);
    expect(isVoiceBlobUrl('not a url', 'user-1')).toBe(false);
  });

  it('extracts question keywords and renders markdown', () => {
    expect(questionKeywords('What did Ana say about pricing?')).toEqual(['pricing']);
    const md = meetingMarkdown(
      {
        id: 'x',
        title: 'Demo',
        myNotes: 'mine',
        enhanced: { summary: 'S', sections: [{ heading: 'H', points: [{ text: 'p', source: 'mine' }] }], decisions: ['d'], actionItems: [{ text: 'a', owner: 'Ana', due: 'Friday' }] },
        segments: [],
        speakers: {},
      } as unknown as VoiceSessionDetail,
      { me: 'Me', them: 'Them', speaker: 'Speaker', privateSpace: 'Voice meetings', summary: 'Summary', decisions: 'Decisions', actionItems: 'Next steps', myNotes: 'My notes', transcript: 'Transcript', fromVoice: 'Meeting' },
    );
    expect(md).toBe('# Demo\n\n## Summary\n\nS\n\n## H\n\n- p\n\n## Decisions\n\n- d\n\n## Next steps\n\n- [ ] a (Ana, Friday)\n');
  });
});

describe('voice recordings lifecycle', () => {
  it('closing a recording queues the notes and the queue writes them', async () => {
    await asUser();
    const id = await newMeeting();
    await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'recording', recorderId: 'tab-aaaaaaaa' }), ctx(id));
    await chunk(id, 'them', 0);
    const { closeRecording } = await import('@/lib/voice');
    const { processQueuedNote } = await import('@/lib/voice-jobs');
    expect(await closeRecording(id, { queueNotes: true })).toEqual({ closed: true, queued: true });
    // Dos cierres a la vez no encolan dos veces.
    expect((await closeRecording(id, { queueNotes: true })).queued).toBe(false);
    expect(await processQueuedNote(id)).toBe('done');
    expect(await processQueuedNote(id)).toBe('skipped');
    const d = (await (await sessionRoute.GET(new Request('http://t') as never, ctx(id))).json()) as VoiceSessionDetail;
    expect(d.status).toBe('done');
    expect(d.notesStatus).toBe('done');
    expect(d.enhanced?.summary).toBeTruthy();
  });

  it('the cron closes stale recordings, writes their notes and cleans untouched meetings', async () => {
    const u = await asUser();
    const stale = await newMeeting('Stale call');
    await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'recording', recorderId: 'tab-aaaaaaaa' }), ctx(stale));
    await chunk(stale, 'them', 0);
    const fresh = await newMeeting('Live call');
    await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'recording', recorderId: 'tab-aaaaaaaa' }), ctx(fresh));
    await chunk(fresh, 'them', 0);
    // Reunión vacía sin tocar (sin título, sin audio, sin notas): no se lista.
    const empty = await newMeeting('');
    const list = (await (await sessionsRoute.GET(new Request('http://t/api/voice/sessions?kind=meeting') as never)).json()) as { sessions: Array<{ id: string }> };
    expect(list.sessions.map((s) => s.id)).not.toContain(empty);
    expect(list.sessions.map((s) => s.id)).toContain(stale);
    const db = getDb();
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    await db.prepare('UPDATE voice_sessions SET last_chunk_at = ?, recorder_seen_at = ?, updated_at = ? WHERE id = ?').run(old, old, old, stale);
    await db.prepare('UPDATE voice_sessions SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3_600_000).toISOString(), empty);
    const { runVoiceCron } = await import('@/lib/voice-jobs');
    const res = await runVoiceCron();
    expect(res.closed).toBeGreaterThanOrEqual(1);
    expect(res.notes).toBeGreaterThanOrEqual(1);
    expect(res.emptyDeleted).toBeGreaterThanOrEqual(1);
    const rows = (await db.prepare('SELECT id, status, notes_status FROM voice_sessions WHERE workspace_id = ?').all(u.id)) as Array<{ id: string; status: string; notes_status: string }>;
    expect(rows.find((r) => r.id === stale)).toMatchObject({ status: 'done', notes_status: 'done' });
    expect(rows.find((r) => r.id === fresh)?.status).toBe('recording');
    expect(rows.find((r) => r.id === empty)).toBeUndefined();
  });

  it('renaming a speaker updates the generated notes', async () => {
    await asUser();
    const id = await newMeeting();
    await chunk(id, 'them', 0);
    await enhanceRoute.POST(jsonReq('http://t', 'POST', {}), ctx(id));
    const before = (await (await sessionRoute.GET(new Request('http://t') as never, ctx(id))).json()) as VoiceSessionDetail;
    expect(JSON.stringify(before.enhanced)).toContain('Them 1');
    await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { speakers: { 'them:0': 'Ana' } }), ctx(id));
    const after = (await (await sessionRoute.GET(new Request('http://t') as never, ctx(id))).json()) as VoiceSessionDetail;
    expect(JSON.stringify(after.enhanced)).not.toContain('Them 1');
    expect(after.enhanced?.actionItems[0].owner).toBe('Ana');
  });

  it('rejects Blob URLs with credentials', () => {
    const prefix = voiceBlobPrefix('user-1');
    expect(isVoiceBlobUrl(`https://u:p@abc123.public.blob.vercel-storage.com/${prefix}rec.webm`, 'user-1')).toBe(false);
  });
});

describe('voice recorder ownership', () => {
  it('only one tab records a meeting and only it uploads chunks', async () => {
    await asUser();
    const id = await newMeeting('Two tabs');
    const claimA = await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'recording', recorderId: 'tab-aaaaaaaa' }), ctx(id));
    expect(claimA.status).toBe(200);
    const claimB = await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'recording', recorderId: 'tab-bbbbbbbb' }), ctx(id));
    expect(claimB.status).toBe(409);
    expect(await claimB.json()).toEqual({ error: 'recording_elsewhere' });
    const fromB = await chunksRoute.POST(audioReq(`http://t/api/voice/sessions/${id}/chunks`, { source: 'me', seq: '0', recorderId: 'tab-bbbbbbbb' }), ctx(id));
    expect(fromB.status).toBe(409);
    const fromA = await chunksRoute.POST(audioReq(`http://t/api/voice/sessions/${id}/chunks`, { source: 'me', seq: '0', recorderId: 'tab-aaaaaaaa' }), ctx(id));
    expect(fromA.status).toBe(201);
    const { recorderHeartbeat, claimRecorder } = await import('@/lib/voice');
    expect(await recorderHeartbeat(id, 'tab-aaaaaaaa')).toBe(true);
    expect(await recorderHeartbeat(id, 'tab-bbbbbbbb')).toBe(false);
    // Sin latido ni trozos por más de 90 s, la otra pestaña puede tomarla.
    const later = new Date(Date.now() + 120_000);
    expect(await claimRecorder(id, 'tab-bbbbbbbb', later)).toBe(true);
    expect(await recorderHeartbeat(id, 'tab-aaaaaaaa')).toBe(false);
    // Con la reunión cerrada se aceptan reintentos de trozos que fallaron.
    await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'done', queueNotes: false }), ctx(id));
    const retry = await chunksRoute.POST(audioReq(`http://t/api/voice/sessions/${id}/chunks`, { source: 'me', seq: '50', recorderId: 'tab-aaaaaaaa' }), ctx(id));
    expect(retry.status).toBe(201);
  });

  it('the cron keeps a silent recording alive while the recorder beats', async () => {
    await asUser();
    const id = await newMeeting('Long silence');
    await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'recording', recorderId: 'tab-cccccccc' }), ctx(id));
    const db = getDb();
    const old = new Date(Date.now() - 15 * 60_000).toISOString();
    // Ningún trozo en 15 minutos, pero el grabador latió recién.
    await db.prepare('UPDATE voice_sessions SET last_chunk_at = ?, updated_at = ?, recorder_seen_at = ? WHERE id = ?').run(old, old, new Date().toISOString(), id);
    const { runVoiceCron } = await import('@/lib/voice-jobs');
    await runVoiceCron({ cleanup: false });
    expect(((await db.prepare('SELECT status FROM voice_sessions WHERE id = ?').get(id)) as { status: string }).status).toBe('recording');
    // Sin latido tampoco: ahora sí se cierra.
    await db.prepare('UPDATE voice_sessions SET recorder_seen_at = ? WHERE id = ?').run(old, id);
    await runVoiceCron({ cleanup: false });
    expect(((await db.prepare('SELECT status FROM voice_sessions WHERE id = ?').get(id)) as { status: string }).status).toBe('done');
  });

  it('closing a meeting that already has AI notes does not regenerate them', async () => {
    await asUser();
    const id = await newMeeting('Already written');
    await chunk(id, 'them', 0);
    await enhanceRoute.POST(jsonReq('http://t', 'POST', {}), ctx(id));
    const { closeRecording, queueNotes } = await import('@/lib/voice');
    await sessionRoute.PATCH(jsonReq('http://t', 'PATCH', { status: 'recording', recorderId: 'tab-dddddddd' }), ctx(id));
    expect((await closeRecording(id, { queueNotes: true })).queued).toBe(false);
    expect(await queueNotes(id)).toBe(false);
    // Regenerar es explícito: el botón llama a /enhance.
    expect((await enhanceRoute.POST(jsonReq('http://t', 'POST', {}), ctx(id))).status).toBe(200);
  });
});
