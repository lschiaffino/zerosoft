import { describe, expect, it } from 'vitest';
import { createEventType, getOrCreateCalendarUser, updateEventType } from '@/lib/calendar';
import {
  addRoutingField,
  addRoutingRule,
  answerParams,
  missingRequiredFields,
  createRoutingForm,
  getRoutingForm,
  listRoutingSubmissions,
  routeAnswers,
  updateRoutingRule,
  withParams,
} from '@/lib/calendar-routing';
import { routingRuleCreateSchema } from '@/lib/calendar-schema';
import { setUserHandle } from '@/lib/db';
import { makeUser } from './helpers';

const routeApi = await import('@/lib/routes/calendar/routing/[id]/route/route');

async function setup() {
  const user = await makeUser('rt');
  await setUserHandle(user.id, `rt-${crypto.randomUUID().slice(0, 8)}`);
  await getOrCreateCalendarUser(user.id);
  const et = await createEventType(user.id, {
    slug: `demo-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Demo',
    durationMin: 30,
    active: true,
  } as Parameters<typeof createEventType>[1]);
  const form = await createRoutingForm(user.id, { slug: `f-${crypto.randomUUID().slice(0, 6)}`, title: 'F' });
  const size = (await addRoutingField(user.id, form.id, { name: 'size', label: 'Tamaño', type: 'select', options: ['1-10', '500+'] }))!;
  await addRoutingField(user.id, form.id, { name: 'company', label: 'Empresa', type: 'text' });
  return { user, et, form, size };
}

function post(formId: string, answers: Record<string, unknown>) {
  return routeApi.POST(
    new Request(`http://localhost/api/calendar/routing/${formId}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ answers }),
    }) as never,
    { params: Promise.resolve({ id: formId }) },
  );
}

describe('Cal: routing forms que terminan en una URL o un mensaje', () => {
  it('cada regla termina en su destino y el respaldo cubre el resto', async () => {
    const { user, et, form, size } = await setup();
    await addRoutingRule(user.id, form.id, { fieldId: size.id, operator: 'is', value: '500+', action: 'url', targetUrl: 'https://example.com/enterprise' });
    await addRoutingRule(user.id, form.id, { fieldId: size.id, operator: 'is', value: '1-10', action: 'event', eventTypeId: et.id });
    const { updateRoutingForm } = await import('@/lib/calendar-routing');
    await updateRoutingForm(user.id, form.id, { fallbackAction: 'message', fallbackMessage: 'Te escribimos pronto.' });
    const full = (await getRoutingForm(user.id, form.id))!;

    expect(await routeAnswers(full, { size: '500+' })).toMatchObject({ kind: 'url', url: 'https://example.com/enterprise' });
    expect(await routeAnswers(full, { size: '1-10' })).toMatchObject({ kind: 'event', slug: et.slug });
    expect(await routeAnswers(full, {})).toMatchObject({ kind: 'message', message: 'Te escribimos pronto.', ruleId: null });

    // Un evento desactivado se saltea y cae al respaldo.
    await updateEventType(user.id, et.id, { active: false });
    expect(await routeAnswers(full, { size: '1-10' })).toMatchObject({ kind: 'message' });
  });

  it('valida que cada destino traiga lo suyo', async () => {
    expect(routingRuleCreateSchema.safeParse({ fieldId: 'f', operator: 'truthy', action: 'url' }).success).toBe(false);
    expect(routingRuleCreateSchema.safeParse({ fieldId: 'f', operator: 'truthy', action: 'url', targetUrl: 'javascript:x' }).success).toBe(false);
    expect(routingRuleCreateSchema.safeParse({ fieldId: 'f', operator: 'truthy', action: 'message', message: 'Hola' }).success).toBe(true);
    expect(routingRuleCreateSchema.safeParse({ fieldId: 'f', operator: 'truthy', eventTypeId: 'e' }).success).toBe(true);
    const { user, form, size } = await setup();
    const rule = (await addRoutingRule(user.id, form.id, { fieldId: size.id, operator: 'truthy', action: 'message', message: 'Hola' }))!;
    await expect(updateRoutingRule(user.id, form.id, rule.id, { action: 'url' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await updateRoutingRule(user.id, form.id, rule.id, { action: 'url', targetUrl: 'https://x.com' }))?.action).toBe('url');
  });

  it('pasa las respuestas como parámetros sin pisar los que ya trae la URL', () => {
    const form = {
      fields: [
        { name: 'size', type: 'select' },
        { name: 'agree', type: 'boolean' },
        { name: 'notes', type: 'text' },
      ],
    } as Parameters<typeof answerParams>[0];
    const params = answerParams(form, { size: '500+', agree: true, notes: ' a\nb ', extra: 'no' });
    expect(params).toEqual([
      ['size', '500+'],
      ['agree', 'true'],
      ['notes', 'a b'],
    ]);
    expect(withParams('https://example.com/x?size=keep#top', params)).toBe('https://example.com/x?size=keep&agree=true&notes=a+b#top');
    expect(withParams('/book/h/demo', [['size', '500+']])).toBe('/book/h/demo?size=500%2B');
    expect(withParams('/book/h/demo', [])).toBe('/book/h/demo');
  });

  it('un sí/no obligatorio acepta "No": solo falta si no se eligió nada', () => {
    const form = { fields: [{ name: 'big', type: 'boolean', required: 1 }, { name: 'co', type: 'text', required: 1 }] } as Parameters<
      typeof missingRequiredFields
    >[0];
    expect(missingRequiredFields(form, { big: false, co: 'Acme' })).toEqual([]);
    expect(missingRequiredFields(form, { big: true, co: 'Acme' })).toEqual([]);
    expect(missingRequiredFields(form, { co: 'Acme' })).toEqual(['big']);
    expect(missingRequiredFields(form, { big: false })).toEqual(['co']);
  });

  it('el endpoint público responde por tipo de destino y registra cada envío', async () => {
    const { user, et, form, size } = await setup();
    await addRoutingRule(user.id, form.id, { fieldId: size.id, operator: 'is', value: '500+', action: 'url', targetUrl: 'https://example.com/ent' });
    await addRoutingRule(user.id, form.id, { fieldId: size.id, operator: 'is', value: '1-10', action: 'event', eventTypeId: et.id });

    const toUrl = await (await post(form.id, { size: '500+', company: 'Acme' })).json();
    expect(toUrl).toEqual({ kind: 'url', url: 'https://example.com/ent?size=500%2B&company=Acme' });
    const toEvent = await (await post(form.id, { size: '1-10', company: 'Acme' })).json();
    expect(toEvent.kind).toBe('event');
    // rsid ata la reserva al envío (embudo del form).
    expect(toEvent.bookPath).toMatch(new RegExp(`/book/rt-[a-z0-9-]+/${et.slug}\\?size=1-10&company=Acme&rsid=[0-9a-f-]{36}$`));
    const none = await post(form.id, { company: 'Nadie' });
    expect(none.status).toBe(404);

    const subs = (await listRoutingSubmissions(user.id, form.id))!;
    expect(subs).toHaveLength(3);
    expect(subs.map((s) => s.outcome).sort()).toEqual(['event', 'none', 'url']);
    expect(subs.find((s) => s.outcome === 'url')).toMatchObject({ target: 'https://example.com/ent', answersParsed: { size: '500+', company: 'Acme' } });
    // Otro usuario no ve los envíos.
    const other = await makeUser('rt-other');
    expect(await listRoutingSubmissions(other.id, form.id)).toBeUndefined();
  });
});
