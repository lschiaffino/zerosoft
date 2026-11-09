import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, getSessionDetail, saveChunkSegments, saveEnhanced, type VoiceOwner } from '@/lib/voice';
import { fakeEnhanced } from '@/lib/voice-ai';
import { meetingMarkdown } from '@/lib/voice-integrations';
import { meetingLabels } from '@/lib/voice-http';
import { attendeeGroups, companyFromDomain, currentCalendarEvent, isFreshMeeting, localDayWindow } from '@/lib/voice-people';
import { chatThreads } from '@/lib/voice-threads';
import { threadMessages, withAttachment } from '@/lib/voice-service';
import { dayWindow } from '@/lib/voice-calendar';
import { followupMailbox, sendFollowup } from '@/lib/voice-prep';
import { upsertIntegration } from '@/lib/integrations';
import { fakeOutlookSent } from '@/lib/microsoft-fake';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role: string; actingUser?: null; team?: null } }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  isWorkspaceAdmin: (u: { role?: string }) => u?.role === 'owner' || u?.role === 'admin',
  realUserId: (u: { id: string }) => u.id,
}));

const chatRoute = await import('@/app/api/voice/sessions/[id]/chat/route');
const assistRoute = await import('@/app/api/voice/sessions/[id]/assist/route');
const sessionRoute = await import('@/lib/routes/voice/sessions/[id]/route');

beforeEach(() => {
  vi.stubEnv('VOICE_AI_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});
afterEach(() => vi.unstubAllEnvs());

function req(method: string, body: unknown) {
  return new Request('http://t', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
}

async function meeting(o: VoiceOwner, lines: string[]) {
  const row = await createSession(o, { kind: 'meeting', title: 'Pricing', status: 'done' });
  await saveChunkSegments({
    sessionId: row.id,
    source: 'them',
    seq: 0,
    offsetMs: 0,
    durationMs: 60_000,
    pieces: lines.map((text, i) => ({ text, startMs: i * 5000, endMs: i * 5000 + 3000, speaker: '' })),
  });
  return row.id;
}

describe('attendees by company', () => {
  it('groups the team first, then companies by domain, then personal emails', () => {
    const groups = attendeeGroups(
      [
        { name: 'Ana', email: 'ana@acme.com' },
        { name: 'Luis', email: 'luis@gmail.com' },
        { name: 'Bea', email: 'bea@acme.com' },
        { name: 'Me', email: 'me@zerosoft.ai' },
        { name: 'Joe', email: 'joe@globex.co.uk' },
        { name: 'No email', email: '' },
      ],
      new Set(['me@zerosoft.ai']),
    );
    expect(groups.map((g) => [g.kind, g.label, g.people.length])).toEqual([
      ['team', '', 1],
      ['company', 'Acme', 2],
      ['company', 'Globex', 1],
      ['personal', '', 2],
    ]);
    expect(companyFromDomain('fake-guest.test')).toBe('Fake-guest');
    expect(companyFromDomain('mail.acme.com.ar')).toBe('Acme');
  });
});

describe('calendar event for a new meeting', () => {
  const now = new Date('2026-11-09T15:00:00Z');
  const ev = (start: string, end: string, sessionId: string | null = null) => ({ startsAt: start, endsAt: end, sessionId });

  it('picks the event happening now or starting within 10 minutes, never one that already has notes', () => {
    expect(currentCalendarEvent([ev('2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z'), ev('2026-11-09T15:04:00Z', '2026-11-09T15:30:00Z')], now)?.startsAt).toBe('2026-11-09T15:04:00Z');
    expect(currentCalendarEvent([ev('2026-11-09T14:45:00Z', '2026-11-09T15:30:00Z'), ev('2026-11-09T15:05:00Z', '2026-11-09T15:30:00Z')], now)?.startsAt).toBe('2026-11-09T15:05:00Z');
    expect(currentCalendarEvent([ev('2026-11-09T14:50:00Z', '2026-11-09T15:30:00Z', 'other')], now)).toBeNull();
    expect(currentCalendarEvent([ev('2026-11-09T15:20:00Z', '2026-11-09T15:50:00Z')], now)).toBeNull();
  });

  it('only a meeting created in the last 15 minutes takes the event on its own', () => {
    expect(isFreshMeeting('2026-11-09T14:50:00Z', now)).toBe(true);
    expect(isFreshMeeting('2026-11-09T14:30:00Z', now)).toBe(false);
    const w = localDayWindow(now);
    expect(Date.parse(w.to) - Date.parse(w.from)).toBe(86_400_000);
  });

  it('accepts a day window from the client but not a wider one', () => {
    expect(dayWindow('2026-11-09T03:00:00.000Z', '2026-11-10T03:00:00.000Z')).not.toBeNull();
    expect(dayWindow('2026-11-01T00:00:00.000Z', '2026-11-10T00:00:00.000Z')).toBeNull();
    expect(dayWindow('nope', '2026-11-10T00:00:00.000Z')).toBeNull();
    expect(dayWindow(null, null)).toBeNull();
  });
});

describe('chat threads, attachments and models', () => {
  it('keeps each chat apart and lists them newest first', () => {
    const msgs = [
      { role: 'user' as const, text: 'First question', at: '2026-11-09T10:00:00Z' },
      { role: 'assistant' as const, text: 'A', at: '2026-11-09T10:00:00Z' },
      { role: 'user' as const, text: 'Other chat', at: '2026-11-09T11:00:00Z', thread: 'b' },
      { role: 'assistant' as const, text: 'B', at: '2026-11-09T11:00:00Z', thread: 'b' },
      { role: 'user' as const, text: 'Second in first', at: '2026-11-09T09:00:00Z' },
    ];
    expect(chatThreads(msgs).map((x) => [x.id, x.title, x.turns])).toEqual([
      ['b', 'Other chat', 1],
      ['', 'First question', 2],
    ]);
    expect(threadMessages(msgs, 'b').map((m) => m.text)).toEqual(['Other chat', 'B']);
    expect(threadMessages(msgs).map((m) => m.text)).toEqual(['First question', 'A', 'Second in first']);
    expect(withAttachment('ctx', { name: 'brief.md', text: 'Budget is 40k' })).toContain('## Attached file: brief.md\nBudget is 40k');
    expect(withAttachment('ctx', { name: 'x', text: '   ' })).toBe('ctx');
  });

  it('saves questions in their chat and reads the attached file', async () => {
    const u = await makeUser('g2-chat');
    session.user = { id: u.id, email: u.email, role: 'owner' };
    const o: VoiceOwner = { workspaceId: u.id, personId: u.id };
    const id = await meeting(o, ['We want annual billing.', 'Launch is in March.']);
    const ctx = { params: Promise.resolve({ id }) };

    let res = await chatRoute.POST(req('POST', { question: 'What about billing?' }), ctx);
    expect(res.status).toBe(200);
    res = await chatRoute.POST(req('POST', { question: 'What is the procurement deadline?', thread: 'newchat1', model: 'deep', attachment: { name: 'rfp.txt', text: 'The procurement deadline is December 4.' } }), ctx);
    const data = (await res.json()) as { chat: Array<{ role: string; text: string; thread?: string }> };
    expect(res.status).toBe(200);
    const answer = data.chat[data.chat.length - 1];
    expect(answer.thread).toBe('newchat1');
    expect(answer.text).toContain('December 4');
    // Un recipe nuevo de fábrica corre en la conversación que se le pasa.
    res = await chatRoute.POST(req('POST', { recipeId: 'builtin:tldr', thread: 'newchat1', locale: 'es' }), ctx);
    expect(res.status).toBe(200);
    const detail = await getSessionDetail(o, id);
    expect(chatThreads(detail!.chat).map((x) => [x.id, x.turns])).toEqual([
      ['newchat1', 2],
      ['', 1],
    ]);
    expect(detail!.chat.find((m) => m.thread === 'newchat1' && m.role === 'user' && m.text.startsWith('/'))?.text).toBe('/Resumen en 3 líneas');
    // Un thread raro se ignora (queda en la primera conversación).
    res = await chatRoute.POST(req('POST', { question: 'Launch?', thread: '../../x' }), ctx);
    expect(((await res.json()) as { chat: Array<{ thread?: string }> }).chat.at(-1)?.thread).toBeUndefined();
  });
});

describe('follow-up email from the connected mailbox', () => {
  it('needs a mailbox, then sends from Outlook and keeps when it went out', async () => {
    vi.stubEnv('MS_GRAPH_FAKE', '1');
    const u = await makeUser('g2-mail');
    session.user = { id: u.id, email: u.email, role: 'owner' };
    const o: VoiceOwner = { workspaceId: u.id, personId: u.id };
    const id = await meeting(o, ['Thanks for the time.']);
    const ctx = { params: Promise.resolve({ id }) };
    const followup = { to: ['ana@acme.com'], subject: 'Next steps', body: 'Thanks, Ana. Here are the next steps.' };

    expect(await followupMailbox(u.id)).toBeNull();
    let res = await assistRoute.POST(req('POST', { kind: 'send', followup }), ctx);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('mailbox_not_connected');
    // Sin destinatarios no sale.
    res = await assistRoute.POST(req('POST', { kind: 'send', followup: { ...followup, to: [] } }), ctx);
    expect(res.status).toBe(400);

    await upsertIntegration({ userId: u.id, provider: 'outlook', email: 'me@acme-out.test', accessToken: 'fake-ms-access-test', refreshToken: 'fake-ms-refresh', expiresAt: Date.now() + 3_600_000, scope: 'Mail.Read Mail.Send offline_access' });
    expect(await followupMailbox(u.id)).toEqual({ email: 'me@acme-out.test', provider: 'outlook' });
    const before = fakeOutlookSent().length;
    res = await assistRoute.POST(req('POST', { kind: 'send', followup }), ctx);
    expect(res.status).toBe(200);
    const sent = (await res.json()) as { via: string; from: string; followup: { sentAt?: string } };
    expect(sent).toMatchObject({ via: 'outlook', from: 'me@acme-out.test' });
    expect(sent.followup.sentAt).toBeTruthy();
    expect(fakeOutlookSent().length).toBe(before + 1);
    expect(fakeOutlookSent().at(-1)?.subject).toBe('Next steps');
    expect((await getSessionDetail(o, id))?.followup?.sentAt).toBeTruthy();

    // La reunión de otra persona no se puede usar para mandar.
    const other = await makeUser('g2-mail-other');
    session.user = { id: other.id, email: other.email, role: 'owner' };
    res = await assistRoute.POST(req('POST', { kind: 'send', followup }), ctx);
    expect(res.status).toBe(404);
    await expect(sendFollowup({ workspaceId: other.id, personId: other.id }, id, followup)).rejects.toThrow('not_found');
  });
});

describe('enhanced notes edited in place', () => {
  it('nests transcript details under your lines and keeps edits without touching the AI date or what was sent', async () => {
    const fake = fakeEnhanced('Pricing per seat', '[00:01] Them: We want annual billing.', ['Notes']);
    expect(fake.sections[0].points.map((p) => [p.source, p.level])).toEqual([
      ['mine', 0],
      ['transcript', 1],
    ]);

    const u = await makeUser('g2-edit');
    session.user = { id: u.id, email: u.email, role: 'owner' };
    const o: VoiceOwner = { workspaceId: u.id, personId: u.id };
    const id = await meeting(o, ['We want annual billing.']);
    const ctx = { params: Promise.resolve({ id }) };
    // Sin nota mejorada no hay nada que editar.
    let res = await sessionRoute.PATCH(req('PATCH', { enhanced: { summary: 'x', sections: [] } }), ctx);
    expect(res.status).toBe(400);

    await saveEnhanced(id, { ...fake, sent: { crm: [{ id: 't1', label: 'Task' }] } });
    const before = await getSessionDetail(o, id);
    const edit = {
      summary: 'Edited summary',
      sections: [{ heading: 'Pricing', points: [{ text: 'Per seat', source: 'mine', level: 0 }, { text: 'Annual billing', source: 'transcript', level: 1 }] }],
    };
    res = await sessionRoute.PATCH(req('PATCH', { enhanced: edit }), ctx);
    expect(res.status).toBe(200);
    const after = await getSessionDetail(o, id);
    expect(after?.enhanced?.summary).toBe('Edited summary');
    expect(after?.enhanced?.sections[0].points[1]).toEqual({ text: 'Annual billing', source: 'transcript', level: 1 });
    expect(after?.enhanced?.sent?.crm).toHaveLength(1);
    expect(after?.enhancedAt).toBe(before?.enhancedAt);
    expect(meetingMarkdown(after!, meetingLabels('en'))).toContain('- Per seat\n  - Annual billing');
    // Un nivel inventado no entra.
    res = await sessionRoute.PATCH(req('PATCH', { enhanced: { ...edit, sections: [{ heading: 'x', points: [{ text: 'y', source: 'mine', level: 3 }] }] } }), ctx);
    expect(res.status).toBe(400);
  });
});
