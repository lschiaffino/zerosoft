import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeCalBookings } from '@/lib/home';
import { voiceOwner } from '@/lib/voice';
import { listLinkableBookings } from '@/lib/voice-integrations';
import { bookingInScope } from '@/lib/calendar-access';
import {
  countUpcomingBookings,
  listUserBookings,
  createBooking,
  createEventType,
  getAvailableSlots,
  getOrCreateCalendarUser,
  getPublicProfile,
  listEventTypes,
  reconfirmBooking,
  setEventHosts,
  updateBooking,
  updateCalendarUser,
} from '@/lib/calendar';
import { createSchedule } from '@/lib/calendar-schedules';
import { listWorkflowSteps, processDueWorkflowRuns, scheduleTriggeredRuns, setWorkflowSteps, computeRunTimes, guestPhone } from '@/lib/calendar-workflows';
import { afterBookingCancelled, afterBookingCreated } from '@/lib/calendar-lifecycle';
import { bookPoll, createPoll, getPoll, listPolls, votePoll } from '@/lib/calendar-polls';
import { deleteInviteeData, previewInviteeData } from '@/lib/calendar-privacy';
import { bookingsCsv } from '@/lib/calendar-export';
import { computeBookingAnalytics, loadAnalyticsRows } from '@/lib/calendar-analytics';
import { computeRoutingFunnel, findCrmContact } from '@/lib/calendar-routing';
import { parseTracking, ga4Snippet, metaPixelSnippet } from '@/lib/calendar-tracking';
import { parsePersonCalendars, setPersonCalendars, writeTarget, checkedCalendars } from '@/lib/calendar-calendars';
import { callingCode, fakeSmsOutbox, getSmsSettings, saveSmsSettings, sendCalSms, toE164 } from '@/lib/calendar-sms';
import { signPayload } from '@/lib/webhooks';
import { hostToken, parseHostToken } from '@/lib/calendar-host-token';
import { listCalActivity, logCalActivity, maskEmail } from '@/lib/calendar-activity';
import { handleCalRpc } from '@/lib/calendar-mcp';
import { upsertIntegration } from '@/lib/integrations';
import { GOOGLE_CALENDAR_PROVIDER, googleBusyRanges, invalidateBusyCache } from '@/lib/google-calendar';
import { FAKE_GOOGLE_TEAM_CALENDAR } from '@/lib/google-calendar-fake';
import { OUTLOOK_CALENDAR_PROVIDER, outlookBusyRanges } from '@/lib/outlook-calendar';
import { FAKE_OUTLOOK_TEAM_CALENDAR, fakeOutlookCalEvents } from '@/lib/microsoft-fake';
import { createExternalForBooking } from '@/lib/calendar-external';
import {
  FAKE_ICLOUD_WORK_CAL,
  connectICloud,
  fakeICloudEvents,
  icloudBusyRanges,
  icsRange,
  invalidateICloudBusyCache,
  listICloudCalendars,
  parseIcsDate,
} from '@/lib/icloud-calendar';
import { connectZoom } from '@/lib/crm-apps';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { makeUser } from './helpers';

function dayAhead(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

async function setup(label: string, extra: Record<string, unknown> = {}) {
  const u = await makeUser(label);
  await getOrCreateCalendarUser(u.id);
  const s = await createSchedule(u.id, {
    name: 'All',
    timezone: 'UTC',
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '18:00' })),
  });
  const et = await createEventType(u.id, {
    slug: `p-${label}-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Intro',
    durationMin: 30,
    scheduleId: s.id,
    ...extra,
  } as Parameters<typeof createEventType>[1]);
  return { u, et };
}

async function row(id: string): Promise<CalendarBookingRow> {
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

beforeEach(() => {
  process.env.CAL_SMS_FAKE = '1';
  process.env.CAL_GOOGLE_FAKE = '1';
  process.env.MS_GRAPH_FAKE = '1';
  process.env.CRM_APPS_FAKE = '1';
  process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CAL_SMS_FAKE;
  delete process.env.CAL_GOOGLE_FAKE;
  delete process.env.MS_GRAPH_FAKE;
  delete process.env.CRM_APPS_FAKE;
  delete process.env.ALLOW_PRIVATE_WEBHOOKS;
});

describe('tipos de evento secretos y página del equipo', () => {
  it('el secreto se reserva pero no sale en el perfil', async () => {
    const { u, et } = await setup('secret', { hidden: true });
    const profile = await getPublicProfile(u.handle!);
    expect(profile?.eventTypes.some((e) => e.id === et.id)).toBe(false);
    expect((await getAvailableSlots(et.id, 'UTC', dayAhead(3))).length).toBeGreaterThan(0);
  });

  it('las personas con nombre que atienden salen en la página del equipo', async () => {
    const { u, et } = await setup('team');
    await getDb().prepare("UPDATE users SET name = 'Ana Host' WHERE id = ?").run(u.id);
    await setEventHosts(et.id, [u.id]);
    const profile = await getPublicProfile(u.handle!);
    expect(profile?.members).toEqual([{ id: u.id, name: 'Ana Host', eventTypeIds: [et.id] }]);
  });
});

describe('workflows con disparadores, SMS y webhook', () => {
  it('relativo al fin: sale después de que termina', () => {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const runs = computeRunTimes(start, [{ id: 'a', offsetMin: 60, trigger: 'end' }, { id: 'b', offsetMin: 0, trigger: 'booked' }], new Date(), end);
    expect(runs).toEqual([{ stepId: 'a', sendAt: new Date(end.getTime() + 3_600_000) }]);
  });

  it('al reservar y al cancelar: email, SMS y webhook', async () => {
    const { u, et } = await setup('wf');
    await saveSmsSettings(u.id, { accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), fromNumber: '+15550001111', allowedCodes: '+54' });
    await setWorkflowSteps(u.id, et.id, [
      { trigger: 'booked', channel: 'sms', recipient: 'guest', offsetMin: 0, subject: '', body: 'Hola {{guest.name}}, {{start}}' },
      { trigger: 'cancelled', channel: 'webhook', recipient: 'host', offsetMin: 0, subject: '', body: '', target: 'http://127.0.0.1:9/hook' },
    ]);
    const booking = await createBooking({
      eventTypeId: et.id,
      email: 'sms@x.com',
      name: 'Sms',
      start: `${dayAhead(3)}T10:00:00.000Z`,
      answers: {},
      location: undefined,
    });
    await getDb().prepare('UPDATE calendar_bookings SET answers = ? WHERE id = ?').run(JSON.stringify({ phone: '+54 9 11 5555 0000' }), booking.id);
    expect(await scheduleTriggeredRuns(booking.id, 'booked')).toBe(1);
    const before = fakeSmsOutbox().length;
    const res = await processDueWorkflowRuns(new Date(Date.now() + 1000));
    expect(res.sent).toBeGreaterThanOrEqual(1);
    const sms = fakeSmsOutbox().slice(before);
    expect(sms.some((m) => m.to === '+5491155550000' && m.body.startsWith('Hola Sms'))).toBe(true);

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push(`${String(url)} ${String(init?.body ?? '')}`);
        return new Response('ok', { status: 200 });
      }),
    );
    const cancelled = await updateBooking(booking.id, { status: 'cancelled', cancelReason: 'x' }, { fromStatus: 'confirmed' });
    await afterBookingCancelled(cancelled!, 'x');
    await processDueWorkflowRuns(new Date(Date.now() + 1000));
    const hook = calls.find((c) => c.startsWith('http://127.0.0.1:9/hook'));
    expect(hook).toContain('"event":"workflow.cancelled"');
    // Firmado con el secreto del paso, como los webhooks del workspace.
    const steps = await listWorkflowSteps(u.id, et.id);
    const secret = steps!.find((s) => s.channel === 'webhook')!.secret;
    expect(secret).toMatch(/^whsec_/);
    const init = (vi.mocked(fetch).mock.calls.find((c) => String(c[0]).startsWith('http://127.0.0.1:9/hook'))?.[1] ?? {}) as RequestInit;
    const headers = new Headers(init.headers);
    const sig = headers.get('zerosoft-signature') ?? '';
    const [, ts] = /t=(\d+)/.exec(sig) ?? [];
    expect(sig).toBe(signPayload(secret, String(init.body), Number(ts)));
    // Guardar de nuevo con el secreto conserva el mismo.
    const again = await setWorkflowSteps(u.id, et.id, steps!.map((s) => ({ ...s })));
    expect(again!.find((s) => s.channel === 'webhook')!.secret).toBe(secret);
  });

  it('SMS: países permitidos, sin repetir el paso y con tope diario', async () => {
    const { u, et } = await setup('smsg');
    await saveSmsSettings(u.id, { accountSid: `AC${'c'.repeat(32)}`, authToken: 'd'.repeat(32), fromNumber: '+5491100000000', dailyLimit: 2 });
    expect((await getSmsSettings(u.id)).allowedCodes).toEqual(['54']);
    expect(callingCode('+5491155550000')).toBe('54');
    expect(callingCode('+15551234567')).toBe('1');
    expect(callingCode('+59899123456')).toBe('598');
    expect((await sendCalSms(u.id, '+15551234567', 'hi')).ok).toBe(false);
    const ok = await sendCalSms(u.id, '+5491155550000', 'hi', { bookingId: 'b1', stepId: 's1' });
    expect(ok.ok).toBe(true);
    const dup = await sendCalSms(u.id, '+5491155550000', 'hi', { bookingId: 'b1', stepId: 's1' });
    expect(dup).toMatchObject({ ok: false, code: 'duplicate' });
    expect((await sendCalSms(u.id, '+5491155550001', 'hi')).ok).toBe(true);
    expect(await sendCalSms(u.id, '+5491155550002', 'hi')).toMatchObject({ ok: false, code: 'daily_limit' });
    void et;
  });

  it('el teléfono del invitado sale de la ubicación o de una respuesta internacional', () => {
    expect(guestPhone({ location_kind: 'phone_host', location: '+1 555 123', answers: '{}' })).toBe('+1 555 123');
    expect(guestPhone({ location_kind: '', location: '', answers: '{"tel":"+44 20 7946 0000"}' })).toBe('+44 20 7946 0000');
    expect(toE164('+44 (20) 7946-0000')).toBe('+442079460000');
    expect(toE164('011 5555')).toBeNull();
  });

  it('reconfirmar queda una sola vez', async () => {
    const { et } = await setup('reconf');
    const b = await createBooking({ eventTypeId: et.id, email: 'r@x.com', name: 'R', start: `${dayAhead(4)}T10:00:00.000Z`, answers: {} });
    expect(await reconfirmBooking(b.id)).toBeTruthy();
    expect(await reconfirmBooking(b.id)).toBeNull();
    expect((await row(b.id)).reconfirmed_at).toBeTruthy();
  });
});

describe('encuestas de horario', () => {
  it('votar, cambiar el voto y reservar con todos invitados', async () => {
    const { u } = await setup('poll');
    const t1 = `${dayAhead(5)}T10:00:00.000Z`;
    const t2 = `${dayAhead(5)}T14:00:00.000Z`;
    const poll = await createPoll(u.id, u.id, { title: 'Kickoff', durationMin: 30, times: [t1, t2, '2001-01-01T00:00:00Z'] });
    expect(poll.options.map((o) => o.startsAt)).toEqual([t1, t2]);
    const [o1, o2] = poll.options;
    const ana = await votePoll(poll.token, { name: 'Ana', email: 'ana@x.com', optionIds: [o1.id], timezone: 'America/Argentina/Buenos_Aires' });
    await votePoll(poll.token, { name: 'Beto', email: 'beto@x.com', optionIds: [o1.id, o2.id], timezone: 'Europe/Madrid' });
    // Otro no puede pisar el voto de Ana con su email; Ana sí, con su token.
    await expect(votePoll(poll.token, { name: 'Impostor', email: 'ana@x.com', optionIds: [o1.id] })).rejects.toThrow('poll_email_taken');
    await votePoll(poll.token, { name: 'Ana', email: 'ANA@x.com', optionIds: [o2.id], timezone: 'America/Argentina/Buenos_Aires', editToken: ana.editToken });
    const voted = await getPoll(u.id, poll.id);
    expect(voted?.votes).toHaveLength(2);
    expect(voted?.votes.find((v) => v.email === 'ana@x.com')?.name).toBe('Ana');
    const { booking } = await bookPoll(u.id, poll.id, o2.id);
    expect(booking.starts_at).toBe(t2);
    expect(booking.invitee_email).toBe('ana@x.com');
    expect(booking.timezone).toBe('America/Argentina/Buenos_Aires');
    expect(JSON.parse(booking.guests)).toEqual(['beto@x.com']);
    expect(JSON.parse((await row(booking.id)).guest_timezones)).toEqual({ 'beto@x.com': 'Europe/Madrid' });
    expect((await getPoll(u.id, poll.id))?.status).toBe('booked');
    await expect(votePoll(poll.token, { name: 'C', email: 'c@x.com', optionIds: [o1.id] })).rejects.toThrow('poll_closed');
    // El tipo oculto que crea la encuesta no sale en la lista.
    expect((await listEventTypes(u.id)).some((e) => e.kind === 'poll')).toBe(false);
    expect((await listPolls(u.id))[0].voteCount).toBe(2);
  });
});

describe('privacidad, export y analytics', () => {
  it('borra las reservas, envíos y votos de un email', async () => {
    const { u, et } = await setup('gdpr');
    const b = await createBooking({ eventTypeId: et.id, email: 'gone@x.com', name: 'G', start: `${dayAhead(6)}T10:00:00.000Z`, answers: {} });
    const other = await createBooking({
      eventTypeId: et.id,
      email: 'stay@x.com',
      name: 'S',
      start: `${dayAhead(6)}T12:00:00.000Z`,
      answers: {},
      guests: ['gone@x.com', 'keep@x.com'],
    });
    const preview = await previewInviteeData(u.id, 'GONE@x.com');
    expect(preview).toMatchObject({ bookings: 1, upcoming: 1, guestOf: 1 });
    await deleteInviteeData(u.id, 'gone@x.com', u.id);
    expect(await getDb().prepare('SELECT 1 FROM calendar_bookings WHERE id = ?').get(b.id)).toBeUndefined();
    expect(JSON.parse((await row(other.id)).guests)).toEqual(['keep@x.com']);
    const log = await listCalActivity(u.id, { group: 'privacy' });
    expect(log[0].summary).toContain('g***@x.com');
    expect(log[0].summary).not.toContain('gone@');
  });

  it('el CSV neutraliza fórmulas y lleva la hora local', () => {
    const csv = bookingsCsv(
      [
        {
          id: 'b1',
          event_type_title: 'Demo',
          status: 'confirmed',
          starts_at: '2026-01-05T13:00:00.000Z',
          ends_at: '2026-01-05T13:30:00.000Z',
          invitee_name: '=HYPERLINK("x")',
          invitee_email: 'a@b.c',
          timezone: 'UTC',
          guests: '[]',
          answers: '{"q":"a, b"}',
          utm: '{"utm_source":"ads"}',
          payment_status: 'none',
          amount_cents: 0,
          created_at: '2026-01-01 10:00:00',
        } as unknown as Parameters<typeof bookingsCsv>[0][number],
      ],
      'America/Argentina/Buenos_Aires',
    );
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('2026-01-05 10:00');
    expect(csv).toContain('ads');
  });

  it('analytics por persona', async () => {
    const { u, et } = await setup('anh');
    await createBooking({ eventTypeId: et.id, email: 'x@x.com', name: 'X', start: `${dayAhead(7)}T10:00:00.000Z`, answers: {} });
    const rows = await loadAnalyticsRows(u.id, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000), { hostId: u.id });
    const a = computeBookingAnalytics(rows, { fromDate: dayAhead(-1), toDate: dayAhead(1), timezone: 'UTC' });
    expect(a.byHost).toHaveLength(1);
    expect(a.byHost[0]).toMatchObject({ id: u.id, created: 1 });
    expect(await loadAnalyticsRows(u.id, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000), { hostId: 'nobody' })).toHaveLength(0);
  });
});

describe('routing: embudo y CRM', () => {
  it('cuenta envíos, derivados y reservas por regla', () => {
    const f = computeRoutingFunnel([
      { outcome: 'event', target: 'demo', rule_id: 'r1', booking_status: 'confirmed' },
      { outcome: 'event', target: 'demo', rule_id: 'r1', booking_status: null },
      { outcome: 'url', target: 'https://x', rule_id: null, booking_status: null },
      { outcome: 'none', target: '', rule_id: null, booking_status: null },
    ]);
    expect(f).toMatchObject({ submissions: 4, routedToEvent: 2, booked: 1, confirmed: 1, routedElsewhere: 1, unrouted: 1, bookingRate: 0.5 });
    expect(f.byRoute[0]).toMatchObject({ ruleId: 'r1', submissions: 2, booked: 1 });
  });

  it('encuentra el contacto del CRM y su owner', async () => {
    const u = await makeUser('crmr');
    await getDb()
      .prepare("INSERT INTO crm_contacts (id, user_id, owner_id, email) VALUES (?, ?, ?, 'Lead@Acme.com')")
      .run(crypto.randomUUID(), u.id, u.id);
    expect((await findCrmContact(u.id, 'lead@acme.com'))?.ownerId).toBe(u.id);
    expect(await findCrmContact(u.id, 'otro@acme.com')).toBeNull();
  });
});

describe('marca, píxeles y calendarios elegidos', () => {
  it('guarda solo ids válidos', async () => {
    const u = await makeUser('px');
    await updateCalendarUser(u.id, { tracking: { ga4: 'g-abc1234', metaPixel: '123456789' }, hideBranding: true });
    const cfg = await getOrCreateCalendarUser(u.id);
    expect(parseTracking(cfg.tracking)).toEqual({ ga4: 'G-ABC1234', metaPixel: '123456789' });
    expect(cfg.hide_branding).toBe(1);
    expect(parseTracking('{"ga4":"<script>"}')).toEqual({});
    expect(ga4Snippet("G-1'); alert(1)//")).toBe('');
    expect(metaPixelSnippet('12345')).toContain("fbq('init','12345')");
  });

  it('dónde se escribe la reserva', () => {
    expect(writeTarget({}, { google: true, outlook: true })).toEqual({ provider: 'google', calendarId: 'primary' });
    expect(writeTarget({ write: { provider: 'outlook', calendarId: 'c1' } }, { google: true, outlook: false })).toEqual({ provider: 'google', calendarId: 'primary' });
    expect(writeTarget({}, { google: false, outlook: false })).toBeNull();
    expect(checkedCalendars(parsePersonCalendars('{"google":{"check":[]}}'), 'google')).toEqual(['primary']);
  });

  it('Google: los calendarios elegidos bloquean horarios', async () => {
    const u = await makeUser('gsel');
    await upsertIntegration({
      userId: u.id, provider: GOOGLE_CALENDAR_PROVIDER, email: 'g@fake', accessToken: 'fake-gcal-access-1', refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000, scope: '',
    });
    const from = new Date(Date.now());
    const to = new Date(Date.now() + 3 * 86_400_000);
    expect(await googleBusyRanges(u.id, from, to)).toHaveLength(0);
    await setPersonCalendars(u.id, { google: { check: ['primary', FAKE_GOOGLE_TEAM_CALENDAR] } });
    invalidateBusyCache(u.id);
    expect((await googleBusyRanges(u.id, from, to)).length).toBe(1);
  });

  it('Outlook: calendario de equipo ocupado y Teams generado por reserva', async () => {
    const { u, et } = await setup('ocal', { locations: [{ kind: 'teams', value: '' }] });
    await upsertIntegration({
      userId: u.id, provider: OUTLOOK_CALENDAR_PROVIDER, email: 'o@fake', accessToken: 'fake-ms-access-1', refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000, scope: 'Calendars.ReadWrite',
    });
    const from = new Date(Date.now());
    const to = new Date(Date.now() + 3 * 86_400_000);
    await setPersonCalendars(u.id, { outlook: { check: [FAKE_OUTLOOK_TEAM_CALENDAR] } });
    expect((await outlookBusyRanges(u.id, from, to)).length).toBeGreaterThanOrEqual(1);
    const b = await createBooking({ eventTypeId: et.id, email: 't@x.com', name: 'T', start: `${dayAhead(8)}T10:00:00.000Z`, answers: {} });
    const synced = await createExternalForBooking(b, et);
    expect(synced.meeting_url).toMatch(/^https:\/\/teams\.microsoft\.com\//);
    expect(synced.outlook_event_id).toBeTruthy();
    expect(fakeOutlookCalEvents().some((e) => e.id === synced.outlook_event_id && e.isOnlineMeeting === true)).toBe(true);
  });

  it('Zoom: una reunión por reserva con la app del workspace', async () => {
    const { u, et } = await setup('zoom', { locations: [{ kind: 'zoom', value: '' }] });
    await connectZoom(u.id, { accountId: 'acc', clientId: 'cid', clientSecret: 'sec' }, u.id);
    const b = await createBooking({ eventTypeId: et.id, email: 'z@x.com', name: 'Z', start: `${dayAhead(9)}T10:00:00.000Z`, answers: {} });
    const synced = await afterBookingCreated(b);
    expect(synced.meeting_url).toMatch(/^https:\/\/zoom\.us\/j\/\d+/);
    expect((await row(b.id)).zoom_meeting_id).toBeTruthy();
  });
});

describe('actividad y MCP', () => {
  it('registra y filtra por grupo', async () => {
    const u = await makeUser('act');
    await logCalActivity(u.id, u.id, 'event_type.created', { type: 'event_type', id: 'x', summary: 'Demo' });
    await logCalActivity(u.id, u.id, 'booking.cancelled', { type: 'booking', id: 'y', summary: 'Ana' });
    expect((await listCalActivity(u.id)).length).toBe(2);
    expect((await listCalActivity(u.id, { group: 'booking' })).map((e) => e.summary)).toEqual(['Ana']);
    expect(maskEmail('juan@acme.com')).toBe('j***@acme.com');
  });

  it('MCP: lista herramientas, horarios y reserva respetando los scopes', async () => {
    const { u, et } = await setup('mcp');
    const ctx = { ws: u.id, personId: u.id, handle: u.handle ?? null, scopes: ['cal:read'] as never };
    const list = (await handleCalRpc(ctx, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((t) => t.name)).toContain('book_meeting');
    const day = dayAhead(10);
    const times = (await handleCalRpc(ctx, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_available_times', arguments: { eventTypeId: et.id, date: day } },
    })) as { result: { structuredContent: { times: Array<{ start: string }> } } };
    const start = times.result.structuredContent.times[0].start;
    const denied = (await handleCalRpc(ctx, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'book_meeting', arguments: { eventTypeId: et.id, start, name: 'M', email: 'm@x.com' } },
    })) as { result: { isError: boolean } };
    expect(denied.result.isError).toBe(true);
    const ok = (await handleCalRpc(
      { ...ctx, scopes: ['cal:read', 'cal:write'] as never },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'book_meeting', arguments: { eventTypeId: et.id, start, name: 'M', email: 'm@x.com' } } },
    )) as { result: { isError: boolean; structuredContent: { booking: { id: string; startsAt: string } } } };
    expect(ok.result.isError).toBe(false);
    expect(ok.result.structuredContent.booking.startsAt).toBe(start);
    expect((await row(ok.result.structuredContent.booking.id)).booked_by).toBe(u.id);
  });
});

describe('iCloud por CalDAV (fake)', () => {
  it('conecta, lista, bloquea lo ocupado y escribe la reserva', async () => {
    process.env.CAL_ICLOUD_FAKE = '1';
    try {
      const { u, et } = await setup('icloud');
      await expect(connectICloud(u.id, 'me@icloud.com', 'wrong')).rejects.toThrow('invalid_input');
      await connectICloud(u.id, 'Me@iCloud.com', 'abcd-efgh-ijkl-mnop');
      const cals = await listICloudCalendars(u.id);
      expect(cals?.map((c) => c.name)).toEqual(['Home', 'Work']);
      const from = new Date();
      const to = new Date(Date.now() + 3 * 86_400_000);
      expect(await icloudBusyRanges(u.id, from, to)).toHaveLength(0);
      await setPersonCalendars(u.id, { icloud: { check: [cals![1].id] }, write: { provider: 'icloud', calendarId: cals![0].id } });
      invalidateICloudBusyCache(u.id);
      expect((await icloudBusyRanges(u.id, from, to)).length).toBe(1);
      expect(cals![1].id.endsWith(FAKE_ICLOUD_WORK_CAL)).toBe(true);
      const b = await createBooking({ eventTypeId: et.id, email: 'ic@x.com', name: 'Ic', start: `${dayAhead(11)}T10:00:00.000Z`, answers: {} });
      const synced = await createExternalForBooking(b, et);
      expect(synced.icloud_event_url).toContain('/home/');
      expect(fakeICloudEvents().some((e) => synced.icloud_event_url!.endsWith(e.href) && e.ics.includes('SUMMARY:Intro - Ic'))).toBe(true);
    } finally {
      delete process.env.CAL_ICLOUD_FAKE;
    }
  });

  it('lee fechas de ICS con zona horaria y días enteros', () => {
    expect(parseIcsDate('20261028T100000', 'America/New_York')?.toISOString()).toBe('2026-10-28T14:00:00.000Z');
    expect(parseIcsDate('20261028T100000Z')?.toISOString()).toBe('2026-10-28T10:00:00.000Z');
    const allDay = icsRange('BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261028\r\nEND:VEVENT');
    expect(allDay!.end.getTime() - allDay!.start.getTime()).toBe(86_400_000);
    expect(icsRange('BEGIN:VEVENT\r\nDTSTART:20261028T100000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT')).toBeNull();
  });
});

describe('borrado de datos del invitado: no queda nada en la base', () => {
  it('ni el email ni el nombre aparecen en ninguna tabla del workspace (salvo el CRM)', async () => {
    const { u, et } = await setup('scan');
    const email = 'Zelda.Scan@Example.com';
    const name = 'Zelda Scanwright';
    await getDb()
      .prepare("INSERT INTO webhooks (id, user_id, url, events, secret) VALUES (?, ?, 'https://example.com/h', '[\"booking.created\"]', 'whsec_x')")
      .run(crypto.randomUUID(), u.id);
    const b = await createBooking({ eventTypeId: et.id, email, name, start: `${dayAhead(12)}T10:00:00.000Z`, answers: {} });
    await afterBookingCreated(b);
    await logCalActivity(u.id, u.id, 'booking.cancelled', { type: 'booking', id: b.id, summary: name });
    const poll = await createPoll(u.id, u.id, { title: 'Scan', durationMin: 30, times: [`${dayAhead(13)}T10:00:00.000Z`, `${dayAhead(13)}T11:00:00.000Z`] });
    await votePoll(poll.token, { name, email, optionIds: [poll.options[0].id] });
    const other = await createBooking({
      eventTypeId: et.id,
      email: 'keep@x.com',
      name: 'Keeper',
      start: `${dayAhead(12)}T12:00:00.000Z`,
      answers: {},
      guests: [email.toLowerCase()],
    });
    await getDb().prepare('UPDATE calendar_bookings SET guest_timezones = ? WHERE id = ?').run(JSON.stringify({ [email.toLowerCase()]: 'UTC' }), other.id);

    await deleteInviteeData(u.id, email, u.id);

    const tables = (await getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) as Array<{ name: string }>;
    const hits: string[] = [];
    for (const { name: table } of tables) {
      // El contacto del CRM es otra app (se borra desde el CRM); las apps de otros tests no son de este workspace.
      if (table.startsWith('crm_') && table !== 'crm_app_log') continue;
      const cols = (await getDb().prepare(`PRAGMA table_info("${table}")`).all()) as Array<{ name: string; type: string }>;
      const text = cols.filter((c) => /TEXT/i.test(c.type) || c.type === '');
      if (text.length === 0) continue;
      const where = text.map((c) => `lower(COALESCE("${c.name}", '')) LIKE ? OR lower(COALESCE("${c.name}", '')) LIKE ?`).join(' OR ');
      const n = (await getDb()
        .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`)
        .get(...text.flatMap(() => [`%${email.toLowerCase()}%`, `%${name.toLowerCase()}%`]))) as { n: number };
      if (Number(n.n) > 0) hits.push(`${table}: ${n.n}`);
    }
    expect(hits).toEqual([]);
  });
});

describe('host opaco', () => {
  it('el token no expone el id y no se puede falsificar', () => {
    const tok = hostToken('user-123');
    expect(tok).not.toContain('user-123');
    expect(parseHostToken(tok)).toBe('user-123');
    expect(parseHostToken('h1:user-123')).toBeNull();
    expect(parseHostToken('user-123')).toBeNull();
    expect(parseHostToken(`${tok.slice(0, -2)}xx`)).toBeNull();
  });
});

describe('borrado de datos: solo lo de esa persona', () => {
  it('a@ no toca a ana@ y un nombre dentro de otro texto queda intacto', async () => {
    const { u, et } = await setup('exact');
    await getDb().prepare('UPDATE calendar_event_types SET title = ? WHERE id = ?').run('Intro Call', et.id);
    const hook = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO webhooks (id, user_id, url, events, secret) VALUES (?, ?, 'https://example.com/h', '[\"booking.created\"]', 'whsec_x')")
      .run(hook, u.id);
    const a = await createBooking({ eventTypeId: et.id, email: 'a@example.com', name: 'Call', start: `${dayAhead(14)}T10:00:00.000Z`, answers: {} });
    const ana = await createBooking({ eventTypeId: et.id, email: 'ana@example.com', name: 'Ana', start: `${dayAhead(14)}T12:00:00.000Z`, answers: {} });
    await afterBookingCreated(a);
    await afterBookingCreated(ana);
    const payloadOf = async (like: string) =>
      ((await getDb().prepare('SELECT payload FROM webhook_deliveries WHERE webhook_id = ? AND payload LIKE ?').get(hook, like)) as { payload: string }).payload;
    const anaBefore = await payloadOf('%ana@example.com%');
    await deleteInviteeData(u.id, 'a@example.com', u.id);
    expect(await getDb().prepare('SELECT 1 FROM calendar_bookings WHERE id = ?').get(a.id)).toBeUndefined();
    expect(await getDb().prepare('SELECT 1 FROM calendar_bookings WHERE id = ?').get(ana.id)).toBeTruthy();
    expect(await payloadOf('%ana@example.com%')).toBe(anaBefore);
    const aPayload = await payloadOf('%[deleted]%');
    expect(aPayload).not.toContain('"a@example.com"');
    // El nombre "Call" se borró como valor, pero el título "Intro Call" sigue igual.
    expect(aPayload).toContain('Intro Call');
    expect(aPayload).not.toContain('"Call"');
  });
});

describe('SMS por horario y alcance de un member', () => {
  it('reprogramar al mismo horario no repite el SMS; a otro horario, sí', async () => {
    const u = await makeUser('smsh');
    await saveSmsSettings(u.id, { accountSid: `AC${'e'.repeat(32)}`, authToken: 'f'.repeat(32), fromNumber: '+5491100000001' });
    const base = { bookingId: 'bk', stepId: 'st' };
    expect((await sendCalSms(u.id, '+5491155551111', 'x', { ...base, startsAt: '2026-11-01T10:00:00.000Z' })).ok).toBe(true);
    expect(await sendCalSms(u.id, '+5491155551111', 'x', { ...base, startsAt: '2026-11-01T10:00:00.000Z' })).toMatchObject({ code: 'duplicate' });
    expect((await sendCalSms(u.id, '+5491155551111', 'x', { ...base, startsAt: '2026-11-02T10:00:00.000Z' })).ok).toBe(true);
  });

  it('MCP: la key de un member lista y cancela solo lo que atiende', async () => {
    const { u, et } = await setup('mcpm');
    const member = await makeUser('mcpm-m');
    const teamId = crypto.randomUUID();
    await getDb().prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(teamId, 'T', u.id);
    await getDb().prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamId, member.id);
    const owners = await createBooking({ eventTypeId: et.id, email: 'o@x.com', name: 'O', start: `${dayAhead(15)}T10:00:00.000Z`, answers: {} });
    const mine = await createBooking({ eventTypeId: et.id, email: 'm@x.com', name: 'M', start: `${dayAhead(15)}T12:00:00.000Z`, answers: {} });
    await getDb().prepare('UPDATE calendar_bookings SET host_user_id = ? WHERE id = ?').run(member.id, mine.id);
    const ctx = { ws: u.id, personId: member.id, handle: null, scopes: ['cal:read', 'cal:write'] as never, role: 'member' as const };
    const call = (name: string, args: Record<string, unknown>) =>
      handleCalRpc(ctx, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as Promise<{
        result: { isError: boolean; structuredContent?: { bookings?: Array<{ id: string }> } };
      }>;
    const list = await call('list_bookings', {});
    expect(list.result.structuredContent?.bookings?.map((b) => b.id)).toEqual([mine.id]);
    expect((await call('cancel_booking', { bookingId: owners.id })).result.isError).toBe(true);
    expect((await call('cancel_booking', { bookingId: mine.id })).result.isError).toBe(false);
  });
});

describe('alcance de member en inicio de Cal, inicio de la plataforma y Voice', () => {
  async function twoHosts(label: string) {
    const { u, et } = await setup(label);
    const member = await makeUser(`${label}-m`);
    const teamId = crypto.randomUUID();
    await getDb().prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(teamId, 'T', u.id);
    await getDb().prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamId, member.id);
    // Hoy (UTC) dentro de un rato: una del owner y una del member.
    const soon = new Date(Date.now() + 60 * 60_000);
    if (soon.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) soon.setTime(Date.now() + 60_000);
    const insert = async (host: string, email: string) => {
      const id = crypto.randomUUID();
      await getDb()
        .prepare(
          `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id, manage_token)
           VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
        )
        .run(id, et.id, email, email, soon.toISOString(), new Date(soon.getTime() + 30 * 60_000).toISOString(), host, crypto.randomUUID().replace(/-/g, ''));
      return id;
    };
    const ownerBooking = await insert(u.id, 'own@x.com');
    const memberBooking = await insert(member.id, 'mem@x.com');
    return { u, member, ownerBooking, memberBooking };
  }

  it('inicio de Cal: el contador semanal y las próximas', async () => {
    const { u, member, memberBooking } = await twoHosts('scopecal');
    expect(await countUpcomingBookings(u.id, 7)).toBe(2);
    expect(await countUpcomingBookings(u.id, 7, new Date(), member.id)).toBe(1);
    const mine = await listUserBookings(u.id, { status: 'confirmed', from: new Date(), hostId: member.id });
    expect(mine.map((b) => b.id)).toEqual([memberBooking]);
  });

  it('inicio de la plataforma: reservas de hoy', async () => {
    const { u, member, memberBooking } = await twoHosts('scopehome');
    const asMember = await homeCalBookings({ id: u.id, role: 'member', actingUser: { id: member.id } });
    expect(asMember.items.map((b) => b.id)).toEqual([memberBooking]);
    const asOwner = await homeCalBookings({ id: u.id, role: 'owner' });
    expect(asOwner.total).toBe(2);
  });

  it('Voice: vincular reunión solo con reservas propias', async () => {
    const { u, member, ownerBooking, memberBooking } = await twoHosts('scopevoice');
    const owner = voiceOwner({ id: u.id, role: 'member', actingUser: { id: member.id } });
    expect((await listLinkableBookings(owner)).map((b) => b.id)).toEqual([memberBooking]);
    expect((await listLinkableBookings(voiceOwner({ id: u.id, role: 'owner' }))).length).toBe(2);
    expect(bookingInScope({ host_user_id: u.id, co_host_ids: '[]' }, owner.bookingScope ?? null)).toBe(false);
    void ownerBooking;
  });
});
