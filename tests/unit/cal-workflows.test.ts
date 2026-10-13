import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooking, createEventType, getOrCreateCalendarUser, rescheduleBooking, updateBooking } from '@/lib/calendar';
import { createSchedule } from '@/lib/calendar-schedules';
import {
  computeRunTimes,
  listWorkflowSteps,
  processDueWorkflowRuns,
  renderWorkflowTemplate,
  setWorkflowSteps,
} from '@/lib/calendar-workflows';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));
const workflowsRoute = await import('@/app/api/calendar/event-types/[id]/workflows/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body?: unknown) =>
  new Request('http://x/api/calendar/event-types/x/workflows', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

function nextDow(dow: number, minDays = 3): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function setup(label: string) {
  const u = await makeUser(label);
  await getOrCreateCalendarUser(u.id);
  const s = await createSchedule(u.id, {
    name: 'Todo',
    timezone: 'UTC',
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '18:00' })),
  });
  const et = await createEventType(u.id, { slug: `wf-${label}`, title: 'Demo', durationMin: 30, scheduleId: s.id });
  return { u, et };
}

async function runsOf(bookingId: string) {
  return (await getDb()
    .prepare('SELECT send_at, sent_at FROM calendar_workflow_runs WHERE booking_id = ? ORDER BY send_at')
    .all(bookingId)) as Array<{ send_at: string; sent_at: string | null }>;
}

const STEPS = [
  { recipient: 'guest' as const, offsetMin: -60, subject: 'En 1h: {{event.title}}', body: 'Hola {{guest.name}}, {{start}}. {{link}} {{nope}}' },
  { recipient: 'host' as const, offsetMin: -1440, subject: 'Mañana con {{guest.name}}', body: 'Reunión con {{guest.email}}' },
  { recipient: 'guest' as const, offsetMin: 120, subject: 'Gracias', body: 'Gracias por venir' },
];

beforeEach(() => {
  session.user = null;
});
afterEach(() => vi.restoreAllMocks());

describe('workflows: cálculo puro', () => {
  it('computeRunTimes ubica cada paso relativo al inicio y descarta los pasados', () => {
    const start = new Date('2026-11-10T15:00:00Z');
    const now = new Date('2026-11-10T00:00:00Z');
    const runs = computeRunTimes(
      start,
      [
        { id: 'a', offsetMin: -60 },
        { id: 'b', offsetMin: -1440 }, // 9/11 15:00 → ya pasó
        { id: 'c', offsetMin: 30 },
      ],
      now,
    );
    expect(runs.map((r) => [r.stepId, r.sendAt.toISOString()])).toEqual([
      ['a', '2026-11-10T14:00:00.000Z'],
      ['c', '2026-11-10T15:30:00.000Z'],
    ]);
  });

  it('renderWorkflowTemplate reemplaza las variables conocidas y deja las desconocidas', () => {
    expect(
      renderWorkflowTemplate('Hola {{ guest.name }}: {{event.title}} {{start}} {{x.y}}', {
        'guest.name': 'Ana',
        'event.title': 'Demo',
        start: 'lunes',
      }),
    ).toBe('Hola Ana: Demo lunes {{x.y}}');
  });
});

describe('workflows: programación y envío', () => {
  it('programa una corrida por paso, reemplaza el recordatorio de 24h y se rehace al reprogramar', async () => {
    const { u, et } = await setup('wf1');
    expect(await setWorkflowSteps(u.id, et.id, STEPS)).toHaveLength(3);
    const day = nextDow(3);
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'Gabi', start: `${day}T10:00:00.000Z` });
    const runs = await runsOf(b.id);
    expect(runs.map((r) => r.send_at)).toEqual([
      new Date(Date.parse(`${day}T10:00:00Z`) - 1440 * 60_000).toISOString(),
      `${day}T09:00:00.000Z`,
      `${day}T12:00:00.000Z`,
    ]);
    const legacy = await getDb().prepare('SELECT COUNT(*) AS c FROM calendar_reminders WHERE booking_id = ?').get(b.id);
    expect(Number((legacy as { c: number }).c)).toBe(0);

    await rescheduleBooking(b.id, new Date(`${day}T14:00:00.000Z`));
    expect((await runsOf(b.id)).map((r) => r.send_at)).toContain(`${day}T13:00:00.000Z`);

    await updateBooking(b.id, { status: 'cancelled' });
    expect(await runsOf(b.id)).toEqual([]);
  });

  it('cambiar los pasos reprograma las reservas próximas', async () => {
    const { u, et } = await setup('wf2');
    const day = nextDow(4);
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'Gabi', start: `${day}T10:00:00.000Z` });
    // Sin pasos: recordatorio fijo de 24h.
    expect(await runsOf(b.id)).toEqual([]);
    await setWorkflowSteps(u.id, et.id, [STEPS[0]]);
    expect((await runsOf(b.id)).map((r) => r.send_at)).toEqual([`${day}T09:00:00.000Z`]);
    const legacy = await getDb()
      .prepare('SELECT COUNT(*) AS c FROM calendar_reminders WHERE booking_id = ? AND sent_at IS NULL')
      .get(b.id);
    expect(Number((legacy as { c: number }).c)).toBe(0);
  });

  it('el cron envía los vencidos con variables, una sola vez, y no envía de reservas canceladas', async () => {
    const { u, et } = await setup('wf3');
    await setWorkflowSteps(u.id, et.id, STEPS);
    const day = nextDow(5);
    const b = await createBooking({
      eventTypeId: et.id,
      email: 'guest@x.com',
      name: 'Gabi <b>',
      start: `${day}T10:00:00.000Z`,
      timezone: 'America/Argentina/Buenos_Aires',
      locale: 'es',
    });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));

    // Una semana después: vencen los tres pasos.
    const later = new Date(Date.parse(`${day}T10:00:00Z`) + 7 * 86_400_000);
    const first = await processDueWorkflowRuns(later);
    // (La base es compartida: puede haber corridas vencidas de otros tests.)
    expect(first.failed).toBe(0);
    expect(first.sent).toBeGreaterThanOrEqual(3);
    const out = logs.join('\n');
    expect(out).toContain('En 1h: Demo');
    expect(out).toContain('Mañana con Gabi <b>');
    expect(out).toContain(`${u.email}`);
    expect(out).toContain('America/Argentina/Buenos_Aires');
    expect(out).toContain('{{nope}}');
    expect(out).toContain('/es/book/manage/');
    expect((await processDueWorkflowRuns(later)).sent).toBe(0);
    expect((await runsOf(b.id)).every((r) => r.sent_at)).toBe(true);

    // Reserva cancelada: sus corridas se borran y no se envía nada.
    const b2 = await createBooking({ eventTypeId: et.id, email: 'h@x.com', name: 'H', start: `${day}T12:00:00.000Z` });
    await updateBooking(b2.id, { status: 'cancelled' });
    expect((await processDueWorkflowRuns(later)).total).toBe(0);
  });

  it('aislamiento: otro workspace no lee ni cambia los pasos (lib y API)', async () => {
    const { u, et } = await setup('wf4');
    const other = await makeUser('wf4b');
    expect(await listWorkflowSteps(other.id, et.id)).toBeNull();
    expect(await setWorkflowSteps(other.id, et.id, STEPS)).toBeNull();

    expect((await workflowsRoute.GET(json('GET'), ctx(et.id))).status).toBe(401);
    session.user = other;
    expect((await workflowsRoute.GET(json('GET'), ctx(et.id))).status).toBe(404);
    expect((await workflowsRoute.PUT(json('PUT', { steps: STEPS }), ctx(et.id))).status).toBe(404);

    session.user = u;
    const bad = await workflowsRoute.PUT(json('PUT', { steps: [{ ...STEPS[0], recipient: 'boss' }] }), ctx(et.id));
    expect(bad.status).toBe(400);
    const ok = await workflowsRoute.PUT(json('PUT', { steps: STEPS.slice(0, 2) }), ctx(et.id));
    expect(ok.status).toBe(200);
    const data = (await (await workflowsRoute.GET(json('GET'), ctx(et.id))).json()) as { steps: Array<{ offsetMin: number }> };
    expect(data.steps.map((s) => s.offsetMin)).toEqual([-60, -1440]);
  });
});
