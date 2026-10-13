import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBooking, createEventType, getOrCreateCalendarUser, setAvailability } from '@/lib/calendar';
import { createContact, listTimeline } from '@/lib/crm';
import { findContactByEmail, logChatToCrm, recordBookingInCrm } from '@/lib/crm-integrations';
import { createWorkflow, listWorkflowRuns } from '@/lib/crm-workflows';
import { getDb, type CalendarBookingRow, type ChatVisitorRow } from '@/lib/db';
import { API_ENDPOINTS } from '@/lib/api-docs';
import {
  activityCreateSchema,
  activityUpdateSchema,
  companyCreateSchema,
  companyUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
  dealCreateSchema,
  dealMoveSchema,
  dealUpdateSchema,
  associationSchema,
  lineItemCreateSchema,
  lineItemUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  quoteCreateSchema,
  quoteUpdateSchema,
  tagApplySchema,
  tagCreateSchema,
  tagUpdateSchema,
} from '@/lib/crm-schema';
import { enrollSchema, unenrollSchema } from '@/lib/crm-email-schema';
import { makeUser } from './helpers';

function nextMonday(): string {
  const d = new Date(Date.now() + 3 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function bookingFor(userId: string, email: string, time = '09:00') {
  await getOrCreateCalendarUser(userId);
  const et = await createEventType(userId, {
    slug: `e-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Intro call',
    durationMin: 30,
    active: true,
  } as Parameters<typeof createEventType>[1]);
  await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] });
  const booking = await createBooking({
    eventTypeId: et.id,
    email,
    name: 'Gabi Pérez',
    start: `${nextMonday()}T${time}:00.000Z`,
    locale: 'en',
  });
  return { et, booking };
}

describe('Cal → CRM', () => {
  afterEach(() => vi.restoreAllMocks());

  it('una reserva crea el contacto y la reunión en su timeline', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const u = await makeUser('cal');
    const wf = await createWorkflow(u.id, {
      name: 'Reunión agendada',
      enabled: true,
      triggers: [{ type: 'meeting_booked' }],
      actions: [{ type: 'notify_user', config: { message: 'Nueva reunión' } }],
    });
    const { booking } = await bookingFor(u.id, 'gabi@empresa.test');
    await recordBookingInCrm(u.id, 'created', booking, 'Intro call');

    const contact = await findContactByEmail(u.id, 'GABI@empresa.test');
    expect(contact?.first_name).toBe('Gabi');
    expect(contact?.last_name).toBe('Pérez');
    const timeline = await listTimeline(u.id, { contactId: contact!.id });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe('meeting');
    expect(timeline[0].subject).toBe('Intro call');
    expect(timeline[0].duration_min).toBe(30);
    expect(timeline[0].due_at).toBe(`${nextMonday()} 09:00:00`);
    expect(await listWorkflowRuns(u.id, wf.id)).toHaveLength(1);

    // Idempotente: registrar la misma reserva otra vez no duplica.
    await recordBookingInCrm(u.id, 'created', booking, 'Intro call');
    expect(await listTimeline(u.id, { contactId: contact!.id })).toHaveLength(1);
  });

  it('usa el contacto existente, y reprogramar/cancelar actualiza la misma actividad', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const u = await makeUser('cal2');
    const existing = await createContact(u.id, { email: 'ya@existe.test', firstName: 'Ya' });
    const { booking } = await bookingFor(u.id, 'ya@existe.test');
    await recordBookingInCrm(u.id, 'created', booking, 'Intro call');

    const moved: CalendarBookingRow = {
      ...booking,
      id: crypto.randomUUID(),
      rescheduled_from: booking.id,
      starts_at: `${nextMonday()}T10:30:00.000Z`,
      ends_at: `${nextMonday()}T11:00:00.000Z`,
    };
    await recordBookingInCrm(u.id, 'rescheduled', moved, 'Intro call');
    let timeline = await listTimeline(u.id, { contactId: existing.id });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].due_at).toBe(`${nextMonday()} 10:30:00`);
    expect(timeline[0].outcome).toBe('rescheduled');

    await recordBookingInCrm(u.id, 'cancelled', moved, 'Intro call', 'Conflicto');
    timeline = await listTimeline(u.id, { contactId: existing.id });
    expect(timeline[0].outcome).toBe('cancelled');
    expect(timeline[0].body).toContain('Conflicto');
    const count = (await getDb()
      .prepare('SELECT COUNT(*) AS n FROM crm_contacts WHERE user_id = ?')
      .get(u.id)) as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('Chat → CRM', () => {
  const visitor = (email: string | null): ChatVisitorRow => ({
    id: crypto.randomUUID(),
    widget_id: 'w',
    external_id: 'x',
    email,
    name: 'Mara Silva',
    notes: null,
    metadata: '{}',
    created_at: '2026-10-12 10:00:00',
  });

  it('crea el contacto y guarda la conversación una sola vez', async () => {
    const u = await makeUser('chat');
    const messages = [
      { sender_type: 'visitor' as const, body: '¿Envían a Brasil?', created_at: '2026-10-12 10:00:00' },
      { sender_type: 'user' as const, body: 'Sí, en 3 a 5 días.', created_at: '2026-10-12 10:01:00' },
    ];
    const first = await logChatToCrm(u.id, { conversationId: 'conv-1', subject: 'Envíos', visitor: visitor('mara@x.test'), messages });
    expect('contact' in first && first.created).toBe(true);
    const again = await logChatToCrm(u.id, {
      conversationId: 'conv-1',
      subject: 'Envíos',
      visitor: visitor('mara@x.test'),
      messages: [...messages, { sender_type: 'visitor' as const, body: 'Gracias', created_at: '2026-10-12 10:02:00' }],
    });
    expect('contact' in again && again.created).toBe(false);
    const contact = await findContactByEmail(u.id, 'mara@x.test');
    const timeline = await listTimeline(u.id, { contactId: contact!.id });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].body).toContain('Mara Silva: ¿Envían a Brasil?');
    expect(timeline[0].body).toContain('Gracias');
  });

  it('sin email no crea nada', async () => {
    const u = await makeUser('chat2');
    const res = await logChatToCrm(u.id, { conversationId: 'c', subject: null, visitor: visitor(null), messages: [] });
    expect(res).toEqual({ error: 'missing_email' });
  });
});

describe('Docs de la API: los ejemplos de request son válidos', () => {
  // Cada ejemplo tiene que pasar el schema real en modo estricto: un campo mal
  // escrito (snake_case, typo) se descartaría en silencio y el ejemplo no haría nada.
  const schemas: Record<string, { strict: () => { safeParse: (v: unknown) => { success: boolean } } }> = {
    'contacts-create': contactCreateSchema,
    'contacts-patch': contactUpdateSchema,
    'companies-create': companyCreateSchema,
    'companies-patch': companyUpdateSchema,
    'deals-create': dealCreateSchema,
    'deals-patch': dealUpdateSchema,
    'deals-move': dealMoveSchema,
    'activities-create': activityCreateSchema,
    'tasks-create': activityCreateSchema.omit({ type: true }),
    'tasks-patch': activityUpdateSchema,
    'sequences-enroll': enrollSchema,
    'sequences-unenroll': unenrollSchema,
    'products-create': productCreateSchema,
    'products-patch': productUpdateSchema,
    'line-items-create': lineItemCreateSchema,
    'line-items-patch': lineItemUpdateSchema,
    'quotes-create': quoteCreateSchema,
    'quotes-patch': quoteUpdateSchema,
    'associations-create': associationSchema,
    'tags-create': tagCreateSchema,
    'tags-patch': tagUpdateSchema,
    'tags-records': tagApplySchema,
  };
  const fill = (v: unknown): unknown =>
    JSON.parse(JSON.stringify(v).replace(/\{[a-z_]+_id\}/g, '00000000-0000-4000-8000-000000000000'));

  for (const [id, schema] of Object.entries(schemas)) {
    it(id, () => {
      const endpoint = API_ENDPOINTS.find((e) => e.id === id);
      expect(endpoint, id).toBeTruthy();
      if (!endpoint?.request) return;
      const res = schema.strict().safeParse(fill(endpoint.request));
      expect(res.success, JSON.stringify(endpoint.request)).toBe(true);
    });
  }
});

describe('OpenAPI', () => {
  it('incluye las rutas v1 documentadas con su método', async () => {
    const { buildOpenApiSpec } = await import('@/lib/openapi');
    const spec = buildOpenApiSpec() as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths['/api/v1/crm/deals/{id}/move']?.post).toBeTruthy();
    expect(spec.paths['/api/v1/crm/contacts/{id}']?.delete).toBeTruthy();
    expect(spec.paths['/api/v1/crm/activities']?.get).toBeTruthy();
    expect(spec.paths['/api/v1/crm/sequences/{id}/enroll']?.post).toBeTruthy();
    expect(spec.paths['/api/v1/crm/email-templates/{id}']?.get).toBeTruthy();
    expect(spec.paths['/api/v1/crm/products/{id}']?.patch).toBeTruthy();
    expect(spec.paths['/api/v1/crm/deals/{id}/line-items/{itemId}']?.delete).toBeTruthy();
    expect(spec.paths['/api/v1/crm/quotes']?.post).toBeTruthy();
    expect(spec.paths['/api/v1/crm/associations']?.delete).toBeTruthy();
    expect(spec.paths['/api/v1/crm/tags/{id}/records']?.post).toBeTruthy();
    expect(Object.keys(spec.paths).every((p) => p.startsWith('/api/v1/'))).toBe(true);
  });
});
