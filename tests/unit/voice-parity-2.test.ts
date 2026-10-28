import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam, removeMember } from '@/lib/teams';
import { attendsBooking } from '@/lib/voice-calendar';
import { voiceDeliveryAllowed } from '@/lib/voice-events';
import { createApiKey } from '@/lib/api-auth';
import { createSession, getSessionDetail, listSessions, saveChunkSegments, saveEnhanced, addDictionaryEntry, listDictionary, saveVoiceSettings, type VoiceOwner } from '@/lib/voice';
import { createFolder, createPrompt, deleteFolder, getUsablePrompt, listFolders, listPrompts, saveWorkspaceSettings, teamUsage, updatePrompt, appOf } from '@/lib/voice-library';
import { listSharedWithMe, resolveShare, revokeShare, setShare } from '@/lib/voice-share';
import { learnCorrections } from '@/lib/voice-learn';
import { purgeTranscripts } from '@/lib/voice-jobs';
import { buildBrief, matchTransform, pastMeetingsWith, runCommand } from '@/lib/voice-prep';
import { fakeRewrite } from '@/lib/voice-ai';
import { handleVoiceRpc } from '@/lib/voice-mcp';
import { meetingLabels, builtinPrompts } from '@/lib/voice-http';
import { notionBlocks, notionPageId } from '@/lib/voice-send';
import { effectiveRetentionDays, type VoiceSessionDetail } from '@/lib/voice-types';
import { parseEventKey } from '@/lib/voice-calendar';
import { composeLinks } from '@/lib/voice-compose';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('VOICE_AI_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});
afterEach(() => vi.unstubAllEnvs());

/** Workspace con dueño y dos miembros. */
async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const a = await makeUser(`${label}-a`);
  const b = await makeUser(`${label}-b`);
  const team = await createTeam(owner.id, `T ${label}`);
  await addMember(team.id, a.id, 'member');
  await addMember(team.id, b.id, 'member');
  const as = (personId: string): VoiceOwner => ({ workspaceId: owner.id, personId });
  return { owner, a, b, team, as };
}

async function meetingWithTranscript(o: VoiceOwner, title: string, opts: { attendees?: Array<{ name: string; email: string }>; endedDaysAgo?: number } = {}) {
  const row = await createSession(o, { kind: 'meeting', title, status: 'done', attendees: opts.attendees });
  await saveChunkSegments({ sessionId: row.id, source: 'them', seq: 0, offsetMs: 0, durationMs: 20_000, pieces: [{ text: 'We want annual billing.', startMs: 0, endMs: 2000, speaker: '' }] });
  if (opts.endedDaysAgo !== undefined) {
    const at = new Date(Date.now() - opts.endedDaysAgo * 86_400_000).toISOString();
    await getDb().prepare('UPDATE voice_sessions SET ended_at = ?, started_at = ? WHERE id = ?').run(at, at, row.id);
  }
  return row.id;
}

describe('learn from corrections', () => {
  it('learns misheard terms and inner capitals, not plain edits', () => {
    expect(learnCorrections('we use zerosof and turso every day', 'we use zerosoft and Turso every day')).toEqual([
      { kind: 'replace', phrase: 'zerosof', replacement: 'zerosoft' },
    ]);
    expect(learnCorrections('ask about zerosoft pricing', 'ask about ZeroSoft pricing')).toEqual([{ kind: 'word', phrase: 'ZeroSoft', replacement: '' }]);
    expect(learnCorrections('book the meeting for monday', 'book the call for Monday')).toEqual([]);
    expect(learnCorrections('the plan', 'a plan')).toEqual([]);
    expect(learnCorrections('send it to ana at acme', 'send it to ana@acme.com')).toHaveLength(1);
    // Lo que ya está en el diccionario no se repite.
    expect(learnCorrections('zerosof', 'zerosoft', [{ kind: 'replace', phrase: 'zerosof' }])).toEqual([]);
  });
});

describe('folders', () => {
  it('one level of subfolders, filter by folder, delete keeps the meetings', async () => {
    const ws = await workspace('vf');
    const me = ws.as(ws.a.id);
    const top = await createFolder(me, { name: 'Customers' });
    const sub = await createFolder(me, { name: 'Acme', parentId: top.id });
    await expect(createFolder(me, { name: 'Too deep', parentId: sub.id })).rejects.toThrow('invalid_state');
    // Una carpeta ajena no sirve de padre.
    await expect(createFolder(ws.as(ws.b.id), { name: 'X', parentId: top.id })).rejects.toThrow('not_found');
    const m1 = await createSession(me, { kind: 'meeting', title: 'In sub', status: 'done', folderId: sub.id });
    await createSession(me, { kind: 'meeting', title: 'Loose', status: 'done' });
    expect((await listSessions(me, { kind: 'meeting', folderId: top.id })).map((s) => s.title)).toEqual(['In sub']);
    expect((await listSessions(me, { kind: 'meeting', folderId: 'none' })).map((s) => s.title)).toEqual(['Loose']);
    expect((await listFolders(me)).find((f) => f.id === sub.id)?.count).toBe(1);
    expect(await listFolders(ws.as(ws.b.id))).toEqual([]);
    expect(await deleteFolder(ws.as(ws.b.id), top.id)).toBe(false);
    expect(await deleteFolder(me, top.id)).toBe(true);
    expect(await listFolders(me)).toEqual([]);
    expect((await getSessionDetail(me, m1.id))?.folderId).toBeNull();
  });
});

describe('share by link', () => {
  it('workspace, people and anyone access; revocable; nothing for outsiders', async () => {
    const ws = await workspace('vs');
    const outsider = await makeUser('vs-out');
    const me = ws.as(ws.a.id);
    const id = await meetingWithTranscript(me, 'Pricing review');
    await saveEnhanced(id, { summary: 'Annual billing agreed.', sections: [], decisions: [], actionItems: [] });
    // Nadie más que quien grabó puede compartir.
    expect((await setShare(ws.as(ws.b.id), id, { access: 'anyone' })).ok).toBe(false);

    const res = await setShare(me, id, { access: 'workspace' });
    if (!res.ok) throw new Error('share');
    const token = res.share.token;
    expect((await resolveShare(token, null)).state).toBe('signin');
    expect((await resolveShare(token, outsider.id)).state).toBe('forbidden');
    const ok = await resolveShare(token, ws.b.id);
    expect(ok.state).toBe('ok');
    if (ok.state === 'ok') {
      expect(ok.view.enhanced?.summary).toBe('Annual billing agreed.');
      // La transcripción no va salvo que se incluya.
      expect(ok.view.segments).toBeNull();
    }
    expect((await listSharedWithMe(ws.as(ws.b.id))).map((m) => m.token)).toEqual([token]);
    expect(await listSharedWithMe(ws.as(ws.a.id))).toEqual([]);

    // Solo personas elegidas.
    expect((await setShare(me, id, { access: 'people', people: [outsider.id] })).ok).toBe(false);
    await setShare(me, id, { access: 'people', people: [ws.owner.id], includeTranscript: true });
    expect((await resolveShare(token, ws.b.id)).state).toBe('forbidden');
    const forOwner = await resolveShare(token, ws.owner.id);
    expect(forOwner.state === 'ok' && forOwner.view.segments?.length).toBe(1);
    expect(await listSharedWithMe(ws.as(ws.b.id))).toEqual([]);

    // Cualquiera con el link; cambiar el link deja el viejo sin andar.
    const anyone = await setShare(me, id, { access: 'anyone', regenerate: true });
    if (!anyone.ok) throw new Error('share');
    expect((await resolveShare(token, null)).state).toBe('not_found');
    expect((await resolveShare(anyone.share.token, null)).state).toBe('ok');

    // Si quien compartió sale del workspace, ni el link de "cualquiera" anda.
    await removeMember(ws.team.id, ws.a.id);
    expect((await resolveShare(anyone.share.token, null)).state).toBe('not_found');
    await addMember(ws.team.id, ws.a.id, 'member');
    expect((await resolveShare(anyone.share.token, null)).state).toBe('ok');

    expect(await revokeShare(ws.as(ws.b.id), id)).toBe(false);
    expect(await revokeShare(me, id)).toBe(true);
    expect((await resolveShare(anyone.share.token, null)).state).toBe('not_found');
    expect((await resolveShare('../etc', null)).state).toBe('not_found');
  });
});

describe('recipes and transforms', () => {
  it('shared prompts are usable by the team but only the owner edits them', async () => {
    const ws = await workspace('vp');
    const mine = await createPrompt(ws.as(ws.a.id), { kind: 'recipe', name: 'Risks', prompt: 'List the risks.', shared: true });
    const priv = await createPrompt(ws.as(ws.a.id), { kind: 'recipe', name: 'Private', prompt: 'Secret.' });
    const other = ws.as(ws.b.id);
    expect((await listPrompts(other, 'recipe')).map((p) => [p.name, p.mine])).toEqual([['Risks', false]]);
    expect(await getUsablePrompt(other, priv.id)).toBeNull();
    expect(await updatePrompt(other, mine.id, { name: 'Hacked' })).toBeNull();
    const outsider = await makeUser('vp-out');
    expect(await listPrompts({ workspaceId: outsider.id, personId: outsider.id }, 'recipe')).toEqual([]);
  });

  it('runs a transform by id or by its spoken name', async () => {
    const u = await makeUser('vcmd');
    const o = { workspaceId: u.id, personId: u.id };
    const builtin = builtinPrompts('en', 'transform');
    const byId = await runCommand({ owner: o, text: 'First idea. Second idea.', transformId: 'builtin:bullets', locale: 'en', builtin });
    expect(byId).toEqual({ text: '- First idea\n- Second idea', instruction: builtin.bullets.prompt, transform: 'Bullet list' });
    const spoken = await runCommand({ owner: o, text: 'First idea. Second idea.', instruction: 'shorter', locale: 'en', builtin });
    expect(spoken.text).toBe('First idea.');
    expect(spoken.transform).toBe('Shorter');
    expect(matchTransform('  More   formal! ', [{ name: 'More formal' }])?.name).toBe('More formal');
    expect(fakeRewrite('hello there', 'make it formal')).toBe('Hello there.');
  });
});

describe('brief before the meeting', () => {
  it('uses only the person’s own meetings with those attendees', async () => {
    const ws = await workspace('vb');
    const ana = { name: 'Ana', email: 'ana@acme.test' };
    const mine = await meetingWithTranscript(ws.as(ws.a.id), 'Kickoff with Ana', { attendees: [ana], endedDaysAgo: 3 });
    await saveEnhanced(mine, { summary: 'Ana wants annual billing.', sections: [], decisions: [], actionItems: [{ text: 'Send the proposal', owner: 'Me', due: '' }] });
    // La reunión de otra persona con Ana no entra en el brief.
    await meetingWithTranscript(ws.as(ws.b.id), 'B with Ana', { attendees: [ana], endedDaysAgo: 2 });
    expect((await pastMeetingsWith(ws.as(ws.a.id), [ana])).map((m) => m.title)).toEqual(['Kickoff with Ana']);
    const brief = await buildBrief({ owner: ws.as(ws.a.id), title: 'Pricing', attendees: [ana], locale: 'en', labels: meetingLabels('en') });
    expect(brief.meetings.map((m) => m.id)).toEqual([mine]);
    expect(brief.summary).toContain('annual billing');
    expect(brief.openItems).toEqual(['Send the proposal (Me)']);
    const none = await buildBrief({ owner: ws.as(ws.a.id), title: 'X', attendees: [{ name: '', email: 'nobody@x.test' }], locale: 'en', labels: meetingLabels('en') });
    expect(none.meetings).toEqual([]);
  });
});

describe('retention', () => {
  it('deletes old transcripts per person and per workspace, keeps notes', async () => {
    expect(effectiveRetentionDays(30, 7)).toBe(7);
    expect(effectiveRetentionDays(0, 0)).toBe(0);
    expect(effectiveRetentionDays(0, 90)).toBe(90);
    const ws = await workspace('vr');
    const a = ws.as(ws.a.id);
    const b = ws.as(ws.b.id);
    const oldA = await meetingWithTranscript(a, 'Old A', { endedDaysAgo: 10 });
    const newA = await meetingWithTranscript(a, 'New A', { endedDaysAgo: 1 });
    const oldB = await meetingWithTranscript(b, 'Old B', { endedDaysAgo: 10 });
    await saveEnhanced(oldA, { summary: 'kept', sections: [], decisions: [], actionItems: [] });
    await saveVoiceSettings(a, { retentionDays: 7 });
    expect(await purgeTranscripts()).toBeGreaterThanOrEqual(1);
    const dA = await getSessionDetail(a, oldA);
    expect(dA?.segments).toEqual([]);
    expect(dA?.transcriptDeletedAt).toBeTruthy();
    expect(dA?.enhanced?.summary).toBe('kept');
    expect((await getSessionDetail(a, newA))?.segments).toHaveLength(1);
    expect((await getSessionDetail(b, oldB))?.segments).toHaveLength(1);
    // Tope del workspace: alcanza a B.
    await saveWorkspaceSettings(ws.owner.id, ws.owner.id, { retentionDays: 7 });
    await purgeTranscripts();
    expect((await getSessionDetail(b, oldB))?.segments).toEqual([]);
    // Compare-and-set: una segunda corrida no vuelve a tocar nada de este workspace.
    const before = (await getDb().prepare('SELECT COUNT(*) AS n FROM voice_sessions WHERE workspace_id = ? AND transcript_deleted_at IS NOT NULL').get(ws.owner.id)) as { n: number };
    await purgeTranscripts();
    const after = (await getDb().prepare('SELECT COUNT(*) AS n FROM voice_sessions WHERE workspace_id = ? AND transcript_deleted_at IS NOT NULL').get(ws.owner.id)) as { n: number };
    expect(after.n).toBe(before.n);
  });
});

describe('team dictionary and usage', () => {
  it('team entries apply to everyone; usage has only numbers', async () => {
    const ws = await workspace('vt');
    await addDictionaryEntry(ws.as(ws.owner.id), { kind: 'word', phrase: 'Turso', shared: true });
    await addDictionaryEntry(ws.as(ws.a.id), { kind: 'word', phrase: 'Personal' });
    expect((await listDictionary(ws.as(ws.b.id))).map((e) => [e.phrase, !!e.shared])).toEqual([['Turso', true]]);
    expect((await listDictionary(ws.as(ws.a.id))).map((e) => e.phrase).sort()).toEqual(['Personal', 'Turso']);
    // La misma frase propia del admin no choca con la del equipo.
    await addDictionaryEntry(ws.as(ws.owner.id), { kind: 'word', phrase: 'Turso' });
    await expect(addDictionaryEntry(ws.as(ws.a.id), { kind: 'word', phrase: 'turso', shared: true })).rejects.toThrow('duplicate');

    await createSession(ws.as(ws.a.id), { kind: 'dictation', text: 'hello secret words here', sourceApp: '/en/app/crm/contacts', durationMs: 60_000 });
    const rows = await teamUsage(ws.owner.id, 30);
    const a = rows.find((r) => r.personId === ws.a.id)!;
    expect(a.dictations).toBe(1);
    expect(a.words).toBe(4);
    expect(a.topApps).toEqual([{ app: 'crm', words: 4 }]);
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(appOf('/es/app/docs/x', 'mic')).toBe('docs');
    expect(appOf('', 'desktop')).toBe('desktop');
  });
});

describe('MCP server', () => {
  it('lists only the key owner’s meetings', async () => {
    const ws = await workspace('vm');
    const mine = await meetingWithTranscript(ws.as(ws.a.id), 'Mine');
    const theirs = await meetingWithTranscript(ws.as(ws.b.id), 'Theirs');
    const ctx = { owner: ws.as(ws.a.id), scopes: ['voice:read' as const] };
    const init = await handleVoiceRpc(ctx, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect((init?.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
    const list = await handleVoiceRpc(ctx, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_meetings', arguments: {} } });
    const out = (list?.result as { structuredContent: { meetings: Array<{ id: string }> } }).structuredContent;
    expect(out.meetings.map((m) => m.id)).toEqual([mine]);
    const other = await handleVoiceRpc(ctx, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_meeting', arguments: { id: theirs } } });
    expect((other?.result as { isError: boolean }).isError).toBe(true);
    const own = await handleVoiceRpc(ctx, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_meeting', arguments: { id: mine, includeTranscript: true } } });
    expect((own?.result as { structuredContent: { transcript: Array<{ text: string }> } }).structuredContent.transcript[0].text).toBe('We want annual billing.');
    const noScope = await handleVoiceRpc({ ...ctx, scopes: [] }, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_meetings', arguments: {} } });
    expect((noScope?.result as { isError: boolean }).isError).toBe(true);
    // La ruta pide voice:read.
    const route = await import('@/app/api/v1/voice/mcp/route');
    const key = await createApiKey(ws.owner.id, 'k', ws.a.id, ['links:read']);
    const res = await route.POST(new Request('http://t/api/v1/voice/mcp', { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
    expect(res.status).toBe(403);
  });
});

describe('webhooks', () => {
  it('voice events only reach webhooks created by the person who recorded', async () => {
    const ws = await workspace('vw');
    const db = getDb();
    const now = new Date().toISOString();
    for (const [id, by] of [
      ['wh-a', ws.a.id],
      ['wh-b', ws.b.id],
    ] as const) {
      await db
        .prepare("INSERT INTO webhooks (id, user_id, url, secret, events, active, created_by, created_at) VALUES (?, ?, 'http://127.0.0.1:9/hook', 'whsec_x', ?, 1, ?, ?)")
        .run(id, ws.owner.id, JSON.stringify(['voice.meeting.completed']), by, now);
    }
    const row = await createSession(ws.as(ws.a.id), { kind: 'meeting', title: 'Secret plan', status: 'recording' });
    const { closeRecording } = await import('@/lib/voice');
    await closeRecording(row.id, { queueNotes: false });
    const deliveries = (await db
      .prepare("SELECT webhook_id, payload, last_error FROM webhook_deliveries WHERE webhook_id IN ('wh-a', 'wh-b')")
      .all()) as Array<{ webhook_id: string; payload: string; last_error: string | null }>;
    expect(deliveries.map((d) => d.webhook_id)).toEqual(['wh-a']);
    expect(JSON.parse(deliveries[0].payload).data.meeting.title).toBe('Secret plan');
    // La entrega se intenta de verdad (no queda bloqueada por el chequeo de acceso).
    expect(deliveries[0].last_error).not.toBe('audience_revoked');
    const data = JSON.parse(deliveries[0].payload).data;
    expect(await voiceDeliveryAllowed(ws.owner.id, ws.a.id, data)).toBe(true);
    // El webhook de otra persona (aunque sea admin o el dueño) no la recibe, y tampoco desde otro workspace.
    expect(await voiceDeliveryAllowed(ws.owner.id, ws.owner.id, data)).toBe(false);
    expect(await voiceDeliveryAllowed(ws.owner.id, ws.b.id, data)).toBe(false);
    expect(await voiceDeliveryAllowed(ws.a.id, ws.a.id, data)).toBe(false);
    await removeMember(ws.team.id, ws.a.id);
    expect(await voiceDeliveryAllowed(ws.owner.id, ws.a.id, data)).toBe(false);
  });
});

describe('per-app access (128_workspace_teams)', () => {
  it('without the voice app: no webhook delivery, no shared links', async () => {
    const ws = await workspace('vapp');
    const id = await meetingWithTranscript(ws.as(ws.a.id), 'App gated');
    const res = await setShare(ws.as(ws.a.id), id, { access: 'workspace' });
    if (!res.ok) throw new Error('share');
    const data = { meeting: { id } };
    expect(await voiceDeliveryAllowed(ws.owner.id, ws.a.id, data)).toBe(true);
    expect((await resolveShare(res.share.token, ws.b.id)).state).toBe('ok');
    // Quien mira sin Voice no abre el link del workspace.
    await getDb().prepare(`UPDATE team_members SET apps = '["crm"]' WHERE user_id = ?`).run(ws.b.id);
    expect((await resolveShare(res.share.token, ws.b.id)).state).toBe('forbidden');
    // Quien grabó sin Voice: ni sus webhooks ni sus links.
    await getDb().prepare(`UPDATE team_members SET apps = '["crm","docs"]' WHERE user_id = ?`).run(ws.a.id);
    expect(await voiceDeliveryAllowed(ws.owner.id, ws.a.id, data)).toBe(false);
    expect((await resolveShare(res.share.token, ws.owner.id)).state).toBe('not_found');
    await getDb().prepare(`UPDATE team_members SET apps = '["voice"]' WHERE user_id = ?`).run(ws.a.id);
    expect(await voiceDeliveryAllowed(ws.owner.id, ws.a.id, data)).toBe(true);
  });
});

describe('calendar scope', () => {
  it('the Voice calendar only has bookings the person hosts or co-hosts, whatever the role', () => {
    const ws = 'ws-owner';
    const admin = { workspaceId: ws, personId: 'admin-1' };
    const owner = { workspaceId: ws, personId: ws };
    expect(attendsBooking({ host_user_id: 'admin-1', co_host_ids: '[]' }, admin)).toBe(true);
    expect(attendsBooking({ host_user_id: 'someone', co_host_ids: '["admin-1"]' }, admin)).toBe(true);
    expect(attendsBooking({ host_user_id: 'someone', co_host_ids: '[]' }, admin)).toBe(false);
    // Sin anfitrión explícito atiende el dueño del tipo de evento (el workspace).
    expect(attendsBooking({ host_user_id: null, co_host_ids: '[]' }, admin)).toBe(false);
    expect(attendsBooking({ host_user_id: null, co_host_ids: '[]' }, owner)).toBe(true);
    expect(attendsBooking({ host_user_id: 'someone', co_host_ids: 'bad' }, owner)).toBe(false);
  });
});

describe('helpers', () => {
  it('parses event keys, Notion page ids, compose links and Notion blocks', () => {
    expect(parseEventKey('google:abc123')).toEqual({ provider: 'google', id: 'abc123' });
    expect(parseEventKey('zoom:1')).toBeNull();
    expect(notionPageId('https://www.notion.so/Acme-Notes-0123456789abcdef0123456789abcdef?pvs=4')).toBe('0123456789abcdef0123456789abcdef');
    expect(notionPageId('not a page')).toBeNull();
    const links = composeLinks({ to: ['ana@acme.test'], subject: 'Hi & bye', body: 'Line 1\nLine 2' });
    expect(links.gmail).toContain('su=Hi%20%26%20bye');
    expect(links.mailto.startsWith('mailto:ana%40acme.test?subject=')).toBe(true);
    const d = {
      title: 'T',
      myNotes: '',
      enhanced: { summary: 'S', sections: [{ heading: 'H', points: [{ text: 'p', source: 'mine' }] }], decisions: ['d'], actionItems: [{ text: 'a', owner: 'Me', due: '' }] },
    } as unknown as VoiceSessionDetail;
    const blocks = notionBlocks(d, meetingLabels('en')).map((b) => b.type);
    expect(blocks).toEqual(['heading_2', 'paragraph', 'heading_2', 'bulleted_list_item', 'heading_2', 'bulleted_list_item', 'heading_2', 'to_do']);
  });
});
