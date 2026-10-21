import { describe, expect, it } from 'vitest';
import {
  createBlockedSlot,
  createBooking,
  createEventType,
  getAvailableSlots,
  getOrCreateCalendarUser,
  rescheduleBooking,
  seatSlotOk,
  seatsLeftAt,
  setAvailability,
  setEventHosts,
  updateCalendarUser,
  updateEventType,
  CalendarError,
} from '@/lib/calendar';
import {
  locationKey,
  locationProblem,
  parseConferencing,
  parseLocations,
  pickLocation,
  publicLocationsJson,
  resolveLocation,
} from '@/lib/calendar-locations';
import { calendarConfigUpdateSchema, eventTypeCreateSchema } from '@/lib/calendar-schema';
import { prefillAnswers } from '@/lib/calendar-questions';
import { bookingWantsMeet } from '@/lib/google-calendar';
import { bookingPayload } from '@/lib/calendar-lifecycle';
import { makeUser } from './helpers';

function nextMonday(minDaysAhead = 2): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function eventFor(label: string, extra: Record<string, unknown> = {}) {
  const user = await makeUser(label);
  await getOrCreateCalendarUser(user.id);
  const et = await createEventType(user.id, {
    slug: `${label}-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Demo',
    durationMin: 30,
    active: true,
    ...extra,
  } as Parameters<typeof createEventType>[1]);
  await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
  return { user, et };
}

const times = (slots: Array<{ start: Date }>) => slots.map((s) => s.start.toISOString().slice(11, 16));

describe('Cal: ubicaciones (puro)', () => {
  it('valida cada tipo y descarta opciones rotas al leer', () => {
    expect(locationProblem({ kind: 'zoom', value: '' })).toBeNull();
    expect(locationProblem({ kind: 'zoom', value: 'zoom.us/j/1' })).toBe('invalid_location_url');
    expect(locationProblem({ kind: 'in_person', value: '' })).toBe('missing_location_value');
    expect(locationProblem({ kind: 'phone_invitee', value: 'llamame' })).toBe('invalid_location_phone');
    expect(locationProblem({ kind: 'fax', value: '' })).toBe('invalid_location');
    expect(
      parseLocations(
        JSON.stringify([
          { kind: 'zoom' },
          { kind: 'zoom', value: '' },
          { kind: 'in_person', value: 'Av. Siempreviva 742' },
          { kind: 'link', value: 'javascript:alert(1)' },
          { kind: 'nope' },
        ]),
      ),
    ).toEqual([
      { kind: 'zoom', value: '' },
      { kind: 'in_person', value: 'Av. Siempreviva 742' },
    ]);
    expect(parseLocations('no json')).toEqual([]);
  });

  it('la página pública recibe los tipos sin links ni teléfonos (salvo la dirección) y en el mismo orden', () => {
    const stored = JSON.stringify([
      { kind: 'zoom', value: 'https://zoom.us/j/1' },
      { kind: 'link', value: 'https://meet.example.com/x' },
      { kind: 'phone_invitee', value: '+1 555 0100' },
      { kind: 'in_person', value: 'Oficina 3' },
    ]);
    const pub = publicLocationsJson(stored);
    expect(pub).not.toContain('zoom.us');
    expect(pub).not.toContain('555');
    const client = parseLocations(pub, { validate: false });
    expect(client.map((o, i) => locationKey(o, i))).toEqual(parseLocations(stored).map((o, i) => locationKey(o, i)));
    expect(client[3]).toEqual({ kind: 'in_person', value: 'Oficina 3' });
  });

  it('elige la opción: una sola va sola, con varias se pide la clave y el teléfono si llama el anfitrión', () => {
    const opts = parseLocations(JSON.stringify([{ kind: 'phone_host' }, { kind: 'in_person', value: 'Oficina' }]));
    expect(pickLocation([], undefined)).toBeNull();
    // Sin elegir (API): la primera que no pide datos.
    expect(pickLocation(opts, undefined)).toEqual({ option: opts[1], phone: '' });
    expect(pickLocation(opts, { key: locationKey(opts[0], 0) })).toEqual({ error: 'invalid_phone' });
    expect(pickLocation(opts, { key: locationKey(opts[0], 0), phone: '+54 11 5555 1234' })).toEqual({
      option: opts[0],
      phone: '+54 11 5555 1234',
    });
    expect(pickLocation(opts, { key: '9:zoom' })).toEqual({ error: 'invalid_location' });
  });

  it('resuelve con el link fijo del anfitrión si la opción no trae uno', () => {
    const host = parseConferencing(JSON.stringify({ zoomUrl: 'https://zoom.us/j/123', phone: '+1 555 0100', teamsUrl: 'nope' }));
    expect(host).toEqual({ zoomUrl: 'https://zoom.us/j/123', phone: '+1 555 0100' });
    expect(resolveLocation({ kind: 'zoom', value: '' }, host)).toEqual({ kind: 'zoom', text: 'https://zoom.us/j/123' });
    expect(resolveLocation({ kind: 'zoom', value: 'https://zoom.us/j/999' }, host).text).toBe('https://zoom.us/j/999');
    expect(resolveLocation({ kind: 'teams', value: '' }, host).text).toBe('');
    expect(resolveLocation({ kind: 'phone_invitee', value: '' }, host).text).toBe('+1 555 0100');
    expect(resolveLocation({ kind: 'phone_host', value: '' }, host, '+54 9 11 1234 5678').text).toBe('+54 9 11 1234 5678');
    expect(bookingWantsMeet({ location_kind: 'google_meet' }, { location: 'Oficina' })).toBe(true);
    expect(bookingWantsMeet({ location_kind: 'zoom' }, { location: '' })).toBe(false);
    expect(bookingWantsMeet({ location_kind: '' }, { location: '' })).toBe(true);
  });

  it('el schema rechaza ubicaciones inválidas y links fijos que no son http', () => {
    const base = { slug: 'x', title: 'X', durationMin: 30 };
    expect(eventTypeCreateSchema.safeParse({ ...base, locations: [{ kind: 'in_person' }] }).success).toBe(false);
    expect(eventTypeCreateSchema.safeParse({ ...base, locations: [{ kind: 'teams' }] }).success).toBe(true);
    expect(calendarConfigUpdateSchema.safeParse({ conferencing: { zoomUrl: 'ftp://x' } }).success).toBe(false);
    expect(calendarConfigUpdateSchema.safeParse({ conferencing: { zoomUrl: '', phone: '+1 555 0100' } }).success).toBe(true);
  });
});

describe('Cal: ubicaciones al reservar', () => {
  it('guarda la ubicación elegida con el link del anfitrión y la manda en el payload', async () => {
    const { user, et } = await eventFor('loc', {
      locations: [{ kind: 'zoom', value: '' }, { kind: 'in_person', value: 'Av. Corrientes 1234' }],
    });
    await updateCalendarUser(user.id, { conferencing: { zoomUrl: 'https://zoom.us/j/42' } });
    const day = nextMonday();
    await expect(
      createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T09:00:00.000Z`, location: { key: '7:zoom' } }),
    ).rejects.toMatchObject({ code: 'invalid_location' });
    const b = await createBooking({
      eventTypeId: et.id,
      email: 'a@x.com',
      name: 'A',
      start: `${day}T09:00:00.000Z`,
      location: { key: '0:zoom' },
    });
    expect(b).toMatchObject({ location_kind: 'zoom', location: 'https://zoom.us/j/42' });
    expect(bookingPayload(b, et).location).toEqual({ kind: 'zoom', value: 'https://zoom.us/j/42' });
    const c = await createBooking({
      eventTypeId: et.id,
      email: 'b@x.com',
      name: 'B',
      start: `${day}T09:30:00.000Z`,
      location: { key: '1:in_person' },
    });
    expect(c).toMatchObject({ location_kind: 'in_person', location: 'Av. Corrientes 1234' });
  });

  it('conferencing: un campo vacío borra, uno ausente no cambia', async () => {
    const user = await makeUser('conf');
    await updateCalendarUser(user.id, { conferencing: { zoomUrl: 'https://zoom.us/j/1', phone: '+1 555 0100' } });
    const after = await updateCalendarUser(user.id, { conferencing: { zoomUrl: '' } });
    expect(parseConferencing(after.conferencing)).toEqual({ phone: '+1 555 0100' });
  });
});

describe('Cal: eventos colectivos', () => {
  it('solo ofrece horarios en que todos los hosts están libres y la reserva los ocupa a todos', async () => {
    const { user, et } = await eventFor('coll');
    const h2 = await makeUser('coll-h2');
    await setEventHosts(et.id, [user.id, h2.id]);
    await updateEventType(user.id, et.id, { scheduling: 'collective' });
    const day = nextMonday();
    await createBlockedSlot(h2.id, { startsAt: `${day}T09:00:00.000Z`, endsAt: `${day}T09:30:00.000Z` } as Parameters<
      typeof createBlockedSlot
    >[1]);
    expect(times(await getAvailableSlots(et.id, 'UTC', day))).toEqual(['09:30', '10:00', '10:30']);
    await expect(
      createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T09:00:00.000Z` }),
    ).rejects.toMatchObject({ code: 'slot_unavailable' });

    const b = await createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T10:00:00.000Z` });
    expect(b.host_user_id).toBe(user.id);
    expect(JSON.parse(b.co_host_ids)).toEqual([h2.id]);

    // El co-anfitrión queda ocupado también en otros eventos suyos.
    const other = await createEventType(h2.id, { slug: `h2-${crypto.randomUUID().slice(0, 6)}`, title: 'H2', durationMin: 30, active: true } as Parameters<
      typeof createEventType
    >[1]);
    await setAvailability(other.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
    expect(times(await getAvailableSlots(other.id, 'UTC', day))).not.toContain('10:00');
    await expect(
      createBooking({ eventTypeId: other.id, email: 'z@x.com', name: 'Z', start: `${day}T10:00:00.000Z` }),
    ).rejects.toMatchObject({ code: 'slot_unavailable' });

    // Reprogramar revisa a todos de nuevo.
    await expect(rescheduleBooking(b.id, new Date(`${day}T09:00:00.000Z`))).rejects.toMatchObject({ code: 'slot_unavailable' });
    const moved = await rescheduleBooking(b.id, new Date(`${day}T10:30:00.000Z`));
    expect(JSON.parse(moved.co_host_ids)).toEqual([h2.id]);
  });

  it('round-robin sigue igual: alcanza con un host libre', async () => {
    const { user, et } = await eventFor('rr');
    const h2 = await makeUser('rr-h2');
    await setEventHosts(et.id, [user.id, h2.id]);
    const day = nextMonday();
    await createBlockedSlot(h2.id, { startsAt: `${day}T09:00:00.000Z`, endsAt: `${day}T09:30:00.000Z` } as Parameters<
      typeof createBlockedSlot
    >[1]);
    expect(times(await getAvailableSlots(et.id, 'UTC', day))).toContain('09:00');
  });
});

describe('Cal: lugares por horario', () => {
  it('helpers: el grupo del mismo inicio tiene que tener lugar y otro grupo superpuesto bloquea', () => {
    const at = (h: string) => new Date(`2030-01-07T${h}:00.000Z`);
    const groups = [
      { start: at('09:00'), end: at('09:30'), count: 2 },
      { start: at('10:00'), end: at('10:30'), count: 3 },
    ];
    expect(seatSlotOk({ start: at('09:00'), end: at('09:30') }, at('09:00'), groups, 3)).toBe(true);
    expect(seatSlotOk({ start: at('10:00'), end: at('10:30') }, at('10:00'), groups, 3)).toBe(false);
    expect(seatSlotOk({ start: at('09:15'), end: at('09:45') }, at('09:15'), groups, 3)).toBe(false);
    expect(seatsLeftAt(at('09:00'), groups, 3)).toBe(1);
    expect(seatsLeftAt(at('11:00'), groups, 3)).toBe(3);
  });

  it('varios invitados reservan el mismo horario hasta llenarlo', async () => {
    const { user, et } = await eventFor('seat', { seats: 2 });
    const day = nextMonday();
    const start = `${day}T09:00:00.000Z`;
    expect((await getAvailableSlots(et.id, 'UTC', day))[0]).toMatchObject({ seatsLeft: 2 });
    const a = await createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start });
    expect(a.seated).toBe(1);
    const slots = await getAvailableSlots(et.id, 'UTC', day);
    expect(slots.find((s) => s.start.toISOString() === start)).toMatchObject({ seatsLeft: 1 });
    const b = await createBooking({ eventTypeId: et.id, email: 'b@x.com', name: 'B', start });
    expect(b.host_user_id).toBe(user.id);
    expect(times(await getAvailableSlots(et.id, 'UTC', day))).not.toContain('09:00');
    await expect(createBooking({ eventTypeId: et.id, email: 'c@x.com', name: 'C', start })).rejects.toMatchObject({
      code: 'slot_unavailable',
    });
    // El grupo ocupa al anfitrión para sus otros eventos.
    const other = await createEventType(user.id, { slug: `o-${crypto.randomUUID().slice(0, 6)}`, title: 'O', durationMin: 30, active: true } as Parameters<
      typeof createEventType
    >[1]);
    await setAvailability(other.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
    expect(times(await getAvailableSlots(other.id, 'UTC', day))).not.toContain('09:00');
    // Un lugar se mueve a otro horario y libera el suyo.
    await rescheduleBooking(b.id, new Date(`${day}T10:00:00.000Z`));
    expect((await getAvailableSlots(et.id, 'UTC', day)).find((s) => s.start.toISOString() === start)).toMatchObject({ seatsLeft: 1 });
  });

  it('dos reservas simultáneas del último lugar: entra una', async () => {
    const { et } = await eventFor('seat-race', { seats: 1 });
    const start = `${nextMonday()}T10:00:00.000Z`;
    const results = await Promise.allSettled([
      createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start }),
      createBooking({ eventTypeId: et.id, email: 'b@x.com', name: 'B', start }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('no va con un link de un solo uso ni con un pool round-robin', async () => {
    const user = await makeUser('seat-bad');
    await getOrCreateCalendarUser(user.id);
    await expect(
      createEventType(user.id, { slug: `s-${crypto.randomUUID().slice(0, 6)}`, title: 'S', durationMin: 30, seats: 5, singleUse: true }),
    ).rejects.toBeInstanceOf(CalendarError);
    const h2 = await makeUser('seat-bad-h2');
    const et = await createEventType(user.id, { slug: `s-${crypto.randomUUID().slice(0, 6)}`, title: 'S', durationMin: 30 });
    await setEventHosts(et.id, [user.id, h2.id]);
    await expect(updateEventType(user.id, et.id, { seats: 3 })).rejects.toMatchObject({ code: 'seats_round_robin' });
    const ok = await updateEventType(user.id, et.id, { seats: 3, scheduling: 'collective' });
    expect(ok?.seats).toBe(3);
  });
});

describe('Cal: respuestas pre-llenadas desde la URL', () => {
  it('solo preguntas que existen y valores válidos para su tipo', () => {
    const qs = [
      { name: 'company', label: 'Empresa', type: 'text' as const, required: false, options: [] },
      { name: 'plan', label: 'Plan', type: 'select' as const, required: false, options: ['Free', 'Pro'] },
      { name: 'topics', label: 'Temas', type: 'checkbox' as const, required: false, options: ['API', 'Ventas'] },
      { name: 'agree', label: 'Acepto', type: 'boolean' as const, required: false, options: [] },
      { name: 'phone', label: 'Tel', type: 'phone' as const, required: false, options: [] },
    ];
    expect(
      prefillAnswers(qs, {
        company: ' Acme\nInc ',
        plan: 'Enterprise',
        topics: 'Ventas, Otro',
        agree: 'true',
        phone: 'no',
        other: 'x',
      }),
    ).toEqual({ company: 'Acme Inc', topics: ['Ventas'], agree: true });
  });
});
