import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImportJob, getImportJob, getImportJobRow, type ImportJobView } from '@/lib/import-jobs';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import { calendlySlug, mapCalendlyEventType, mapCalendlyLocation, mapCalendlyQuestions, mapCalendlySchedule } from '@/lib/cal-import';
import { listEventTypes, createEventType } from '@/lib/calendar';
import { listSchedules } from '@/lib/calendar-schedules';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

async function runToEnd(id: string): Promise<ImportJobView> {
  for (let i = 0; i < 30; i++) {
    const v = (await runImportJob(id, 5_000))!;
    if (!['fetching', 'importing'].includes(v.status)) return v;
  }
  throw new Error('stuck');
}

const EVENT_TYPE = {
  uri: 'https://api.calendly.com/event_types/ET1',
  name: 'Intro call',
  slug: 'intro-call',
  duration: 30,
  description_plain: 'A quick intro',
  color: '#8247f5',
  active: true,
  type: 'StandardEventType',
  locations: [{ kind: 'zoom_conference' }, { kind: 'physical', location: 'Av. Siempre Viva 742' }, { kind: 'ask_invitee' }],
  custom_questions: [
    { name: 'Company size', type: 'single_select', enabled: true, required: true, position: 1, answer_choices: ['1-10', '11-50'] },
    { name: 'Anything else?', type: 'text', enabled: true, required: false, position: 0 },
    { name: 'Hidden', type: 'string', enabled: false, position: 2 },
  ],
};

describe('Calendly: mapeo', () => {
  it('horarios semanales y excepciones por fecha', () => {
    const s = mapCalendlySchedule({
      uri: 'S1',
      name: 'Working hours',
      timezone: 'America/Argentina/Buenos_Aires',
      default: true,
      rules: [
        { type: 'wday', wday: 'monday', intervals: [{ from: '09:00', to: '12:00' }, { from: '13:00', to: '17:00' }] },
        { type: 'wday', wday: 'sunday', intervals: [] },
        { type: 'date', date: '2024-12-25', intervals: [] },
        { type: 'date', date: '2024-12-24', intervals: [{ from: '09:00', to: '12:00' }] },
      ],
    });
    expect(s.rules).toEqual([
      { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
      { dayOfWeek: 1, startTime: '13:00', endTime: '17:00' },
    ]);
    expect(s.overrides).toEqual([
      { date: '2024-12-25', startTime: null, endTime: null },
      { date: '2024-12-24', startTime: '09:00', endTime: '12:00' },
    ]);
  });

  it('ubicaciones, preguntas y slug', () => {
    expect(mapCalendlyLocation({ kind: 'google_conference' })).toEqual({ kind: 'google_meet', value: '' });
    expect(mapCalendlyLocation({ kind: 'custom', location: 'https://meet.example.com/x' })).toEqual({ kind: 'link', value: 'https://meet.example.com/x' });
    expect(mapCalendlyLocation({ kind: 'ask_invitee' })).toBeNull();
    const qs = mapCalendlyQuestions(EVENT_TYPE.custom_questions);
    expect(qs).toEqual([
      { name: 'anything_else', label: 'Anything else?', type: 'textarea', required: false },
      { name: 'company_size', label: 'Company size', type: 'radio', required: true, options: ['1-10', '11-50'] },
    ]);
    expect(calendlySlug('Démo Call!!', 'x')).toBe('demo-call');
    const et = mapCalendlyEventType(EVENT_TYPE);
    expect(et.locations).toHaveLength(2);
    expect(et.unmapped).toEqual(['ask_invitee']);
  });
});

describe('Calendly: job de punta a punta', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('importa horarios, tipos de evento y reservas; reimportar no duplica', async () => {
    const u = await makeUser('cly');
    // Un slug tomado: el importado queda con sufijo.
    await createEventType(u.id, { slug: 'intro-call', title: 'Existing', durationMin: 15 });
    const future = new Date(Date.now() + 3 * 86400_000);
    const routes: Record<string, unknown> = {
      '/users/me': { resource: { uri: 'https://api.calendly.com/users/U1', timezone: 'UTC' } },
      '/user_availability_schedules': {
        collection: [
          {
            uri: 'https://api.calendly.com/user_availability_schedules/S1',
            name: 'Working hours',
            default: true,
            timezone: 'Europe/Madrid',
            rules: [{ type: 'wday', wday: 'tuesday', intervals: [{ from: '10:00', to: '16:00' }] }],
          },
        ],
      },
      '/event_types': { collection: [EVENT_TYPE, { ...EVENT_TYPE, uri: 'X', type: 'AdhocEventType', name: 'One-off' }], pagination: { next_page_token: null } },
      '/scheduled_events': {
        collection: [
          {
            uri: 'https://api.calendly.com/scheduled_events/EV1',
            start_time: future.toISOString(),
            end_time: new Date(future.getTime() + 30 * 60_000).toISOString(),
            event_type: EVENT_TYPE.uri,
            location: { join_url: 'https://zoom.us/j/1' },
          },
        ],
        pagination: { next_page_token: null },
      },
      '/scheduled_events/EV1/invitees': {
        collection: [{ email: 'guest@acme.test', name: 'Guest', timezone: 'UTC', questions_and_answers: [{ question: 'Company size', answer: '1-10' }] }],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer cly_test_token');
        const path = new URL(String(url)).pathname;
        const body = routes[path];
        return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
      }),
    );

    const job = await createImportJob({
      workspaceId: u.id,
      teamId: null,
      userId: u.id,
      app: 'cal',
      source: 'calendly',
      secret: 'cly_test_token',
      options: { includeBookings: true },
    });
    const prev = await runToEnd(job.id);
    expect(prev.status).toBe('preview');
    expect((await getImportJobRow(job.id))?.secret).toBeNull();
    expect(prev.preview).toMatchObject({ bookings: 1, includeBookings: true });
    expect((prev.preview as { eventTypes: unknown[] }).eventTypes).toHaveLength(1);

    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.status).toBe('done');
    expect(done.report).toMatchObject({ schedules: 1, eventTypes: 1, bookings: 1, renamed: [{ from: 'intro-call', to: 'intro-call-2' }] });

    const types = await listEventTypes(u.id);
    const imported = types.find((t) => t.slug === 'intro-call-2')!;
    expect(imported).toMatchObject({ title: 'Intro call', duration_min: 30, description: 'A quick intro' });
    expect(JSON.parse(imported.locations)).toEqual([
      { kind: 'zoom', value: '' },
      { kind: 'in_person', value: 'Av. Siempre Viva 742' },
    ]);
    expect(JSON.parse(imported.fields).map((f: { name: string }) => f.name)).toEqual(['anything_else', 'company_size']);
    const schedules = await listSchedules(u.id);
    const madrid = schedules.find((s) => s.timezone === 'Europe/Madrid')!;
    expect(madrid.rules).toEqual([{ dayOfWeek: 2, startTime: '10:00', endTime: '16:00' }]);
    expect(imported.schedule_id).toBe(madrid.id);
    const booking = (await getDb().prepare('SELECT * FROM calendar_bookings WHERE event_type_id = ?').get(imported.id)) as Record<string, string>;
    expect(booking).toMatchObject({ invitee_email: 'guest@acme.test', status: 'confirmed', location: 'https://zoom.us/j/1' });

    const again = await createImportJob({
      workspaceId: u.id,
      teamId: null,
      userId: u.id,
      app: 'cal',
      source: 'calendly',
      secret: 'cly_test_token',
      options: { includeBookings: true },
    });
    await runToEnd(again.id);
    await startImportJob((await getImportJob(again.id))!);
    const done2 = await runToEnd(again.id);
    expect(done2.report).toMatchObject({ schedules: 0, eventTypes: 0, bookings: 0, skipped: 3 });
    expect((await listEventTypes(u.id)).length).toBe(types.length);
  });
});
