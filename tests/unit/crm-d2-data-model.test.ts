/**
 * CRM, bloque D2 (modelo de datos): grupos y descripción de propiedades,
 * propiedades de valor único (lib/crm-unique.ts), tipo de deal, próximo paso y
 * motivo de ganado, y el historial de propiedades con los permisos de la ficha.
 * Los datos son inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createPipeline,
  createStage,
  getContact,
  listDeals,
  updateContact,
  updateCustomField,
  updateDeal,
} from '@/lib/crm';
import { groupCustomFields } from '@/lib/crm-custom-fields';
import { customFieldSections, customPropFields } from '@/components/crm/customPropFields';
import { CrmUniqueValueError, uniqueKey } from '@/lib/crm-unique';
import { CrmRefError } from '@/lib/crm-refs';
import { bulkSetProperty } from '@/lib/crm-bulk';
import { importContacts } from '@/lib/crm-import';
import { createForm, submitForm } from '@/lib/crm-forms';
import type { FormField } from '@/lib/crm-forms-schema';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { dealUpdateSchema } from '@/lib/crm-schema';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));

const fieldsRoute = await import('@/app/api/crm/custom-fields/route');
const fieldRoute = await import('@/lib/routes/crm/custom-fields/[id]/route');
const contactRoute = await import('@/lib/routes/crm/contacts/[id]/route');
const contactsRoute = await import('@/app/api/crm/contacts/route');
const dealRoute = await import('@/lib/routes/crm/deals/[id]/route');
const historyRoute = await import('@/app/api/crm/history/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

async function pipeline(ws: string): Promise<{ pipelineId: string; stageId: string }> {
  const p = await createPipeline(ws, 'Ventas');
  const s = await createStage(ws, p.id, { name: 'Abierto' });
  return { pipelineId: p.id, stageId: s!.id };
}

describe('grupos y descripción de propiedades', () => {
  it('agrupa sin distinguir mayúsculas; las sin grupo van primero', () => {
    const defs = [
      { name: 'a', group_name: 'Facturación' },
      { name: 'b', group_name: '' },
      { name: 'c', group_name: 'facturación ' },
      { name: 'd', group_name: 'Onboarding' },
    ];
    expect(groupCustomFields(defs).map((g) => [g.group, g.defs.map((d) => d.name)])).toEqual([
      ['', ['b']],
      ['Facturación', ['a', 'c']],
      ['Onboarding', ['d']],
    ]);
  });

  it('la ficha arma una tarjeta por grupo, con la descripción como ayuda y sin los campos ocultos', () => {
    const base = { user_id: 'w', entity: 'deals', options: '[]', position: 0 };
    const defs = [
      { ...base, id: '1', name: 'po', label: 'PO', type: 'text' as const, group_name: 'Billing', description: 'Purchase order number' },
      { ...base, id: '2', name: 'tier', label: 'Tier', type: 'text' as const, group_name: '', description: '' },
      { ...base, id: '3', name: 'secret', label: 'Secret', type: 'text' as const, group_name: 'Billing!', access: 'hidden' as const },
    ];
    const fields = customPropFields(defs, {}, { yes: 'Yes', no: 'No' });
    expect(fields.map((f) => [f.key, f.help])).toEqual([
      ['custom.po', 'Purchase order number'],
      ['custom.tier', undefined],
    ]);
    expect(customFieldSections(defs, fields, 'Other')).toEqual([
      { id: 'custom', title: 'Other', keys: ['custom.tier'] },
      { id: 'custom.billing', title: 'Billing', keys: ['custom.po'] },
    ]);
  });

  it('se guardan y se editan con el campo', async () => {
    const ws = (await makeUser('d2-groups')).id;
    const f = await createCustomField(ws, { entity: 'contacts', name: 'vat', label: 'VAT', type: 'text', group: 'Billing', description: 'Tax id' });
    expect(f).toMatchObject({ group_name: 'Billing', description: 'Tax id', is_unique: 0 });
    const u = await updateCustomField(ws, f.id, { group: '', description: 'Tax id of the buyer' });
    expect(u).toMatchObject({ group_name: '', description: 'Tax id of the buyer' });
  });
});

describe('valor único', () => {
  async function setup(label: string) {
    const ws = (await makeUser(label)).id;
    const field = await createCustomField(ws, { entity: 'contacts', name: 'vat', label: 'VAT', type: 'text', isUnique: true });
    const num = await createCustomField(ws, { entity: 'contacts', name: 'ext_id', label: 'External id', type: 'number', isUnique: true });
    return { ws, field, num };
  }

  it('compara texto sin mayúsculas ni espacios y número por valor; vacío no cuenta', async () => {
    expect(uniqueKey('text', '  AB-1 ')).toBe('ab-1');
    expect(uniqueKey('number', '7')).toBe(7);
    expect(uniqueKey('text', '')).toBeNull();
    const { ws } = await setup('d2-uniq');
    await createContact(ws, { firstName: 'Uno', custom: { vat: 'AR-100', ext_id: 7 } });
    const err = await rejection(createContact(ws, { firstName: 'Dos', custom: { vat: ' ar-100 ' } }));
    expect(err).toBeInstanceOf(CrmUniqueValueError);
    expect((err as CrmUniqueValueError).code).toBe('value_taken');
    expect(await rejection(createContact(ws, { firstName: 'Tres', custom: { ext_id: 7 } }))).toBeInstanceOf(CrmUniqueValueError);
    // Vacío y valores distintos pasan.
    await createContact(ws, { firstName: 'Cuatro', custom: { vat: '' } });
    await createContact(ws, { firstName: 'Cinco', custom: { vat: 'AR-200', ext_id: 8 } });
  });

  it('editar sin cambiar el valor pasa, aunque sea un duplicado de antes de la regla', async () => {
    const ws = (await makeUser('d2-legacy')).id;
    const field = await createCustomField(ws, { entity: 'contacts', name: 'vat', label: 'VAT', type: 'text' });
    const a = await createContact(ws, { firstName: 'A', custom: { vat: 'X1' } });
    const b = await createContact(ws, { firstName: 'B', custom: { vat: 'X1' } });
    // Con duplicados no se puede prender.
    expect(await rejection(updateCustomField(ws, field.id, { isUnique: true }))).toMatchObject({ code: 'not_unique' });
    // Se prende directo en la base para simular un duplicado viejo.
    await getDb().prepare('UPDATE crm_custom_fields SET is_unique = 1 WHERE id = ?').run(field.id);
    expect(await updateContact(ws, b.id, { firstName: 'B2', custom: { vat: 'X1' } })).toMatchObject({ first_name: 'B2' });
    // Cambiar a otro valor que ya existe no.
    await createContact(ws, { firstName: 'C', custom: { vat: 'X2' } });
    expect(await rejection(updateContact(ws, a.id, { custom: { vat: 'x2' } }))).toBeInstanceOf(CrmUniqueValueError);
  });

  it('solo para contactos, empresas y deals, y para texto, número, url o teléfono', async () => {
    const ws = (await makeUser('d2-types')).id;
    expect(
      await rejection(createCustomField(ws, { entity: 'contacts', name: 'pick', label: 'Pick', type: 'select', options: ['a'], isUnique: true })),
    ).toMatchObject({ code: 'invalid_unique' });
    expect(
      await rejection(createCustomField(ws, { entity: 'leads', name: 'code', label: 'Code', type: 'text', isUnique: true })),
    ).toMatchObject({ code: 'invalid_unique' });
    const ok = await createCustomField(ws, { entity: 'companies', name: 'duns', label: 'DUNS', type: 'text', isUnique: true });
    expect(ok.is_unique).toBe(1);
    await createCompany(ws, { name: 'Acme', custom: { duns: '15-048-3782' } });
    expect(await rejection(createCompany(ws, { name: 'Acme 2', custom: { duns: '15-048-3782' } }))).toBeInstanceOf(CrmUniqueValueError);
  });

  it('cada workspace tiene sus valores', async () => {
    const a = await setup('d2-ws-a');
    const b = await setup('d2-ws-b');
    await createContact(a.ws, { firstName: 'A', custom: { vat: 'SAME' } });
    expect(await createContact(b.ws, { firstName: 'B', custom: { vat: 'SAME' } })).toMatchObject({ first_name: 'B' });
  });

  it('deals: alta y edición respetan la regla', async () => {
    const ws = (await makeUser('d2-deal-uniq')).id;
    await createCustomField(ws, { entity: 'deals', name: 'po', label: 'PO', type: 'text', isUnique: true });
    const { pipelineId, stageId } = await pipeline(ws);
    const one = await createDeal(ws, { name: 'Uno', pipelineId, stageId, custom: { po: 'PO-1' } });
    if (!one.ok) throw new Error('deal');
    expect(await rejection(createDeal(ws, { name: 'Dos', pipelineId, stageId, custom: { po: 'po-1' } }))).toBeInstanceOf(CrmRefError);
    const two = await createDeal(ws, { name: 'Dos', pipelineId, stageId, custom: { po: 'PO-2' } });
    if (!two.ok) throw new Error('deal');
    expect(await rejection(updateDeal(ws, two.deal.id, { custom: { po: 'PO-1' } }))).toBeInstanceOf(CrmUniqueValueError);
  });

  it('edición en masa: falla el registro que repetiría el valor, el resto sigue', async () => {
    const { ws } = await setup('d2-bulk');
    const a = await createContact(ws, { firstName: 'A' });
    const b = await createContact(ws, { firstName: 'B' });
    const res = await bulkSetProperty(ws, 'contact', [a.id, b.id], 'custom:vat', 'BULK-1');
    expect(res).toMatchObject({ ok: true, count: 1, failed: 1 });
  });

  it('import: la fila que repite el valor queda como error sin decir de quién es; las demás entran', async () => {
    const { ws } = await setup('d2-import');
    await createContact(ws, { firstName: 'Existente', lastName: 'Oculta', custom: { vat: 'IMP-1' } });
    const res = await importContacts(
      ws,
      [
        { email: 'una@import.test', firstName: 'Una', custom: { vat: 'imp-1' } },
        { email: 'otra@import.test', firstName: 'Otra', custom: { vat: 'IMP-2' } },
      ],
      'skip',
    );
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('Row 1');
    expect(res.errors[0]).not.toMatch(/Existente|Oculta|IMP-1/i);
  });

  it('formulario público: el valor repetido se descarta en silencio y el envío se guarda igual', async () => {
    const { ws } = await setup('d2-form');
    const other = await createContact(ws, { firstName: 'Dueña', custom: { vat: 'FORM-1' } });
    const FIELDS: FormField[] = [
      { id: 'email', type: 'email', label: 'Email', property: 'email', required: true },
      { id: 'vat', type: 'text', label: 'VAT', property: 'custom.vat', required: false },
    ];
    const form = await createForm(ws, { name: 'Alta', fields: FIELDS, settings: { minSubmitSeconds: 0, updateExisting: false } });
    const taken = await submitForm(form.token, { values: { email: 'nuevo@form.test', vat: 'form-1' }, elapsedMs: 9000 });
    const free = await submitForm(form.token, { values: { email: 'libre@form.test', vat: 'FORM-2' }, elapsedMs: 9000 });
    // Misma forma de respuesta en los dos casos: no dice si el valor existía.
    expect(Object.keys(taken).sort()).toEqual(Object.keys(free).sort());
    expect(taken).toMatchObject({ ok: true, created: true });
    const created = (await getDb()
      .prepare("SELECT custom FROM crm_contacts WHERE user_id = ? AND email = 'nuevo@form.test'")
      .get(ws)) as { custom: string };
    expect(JSON.parse(created.custom)).not.toHaveProperty('vat');
    expect((await getContact(ws, other.id))!.contact.custom).toContain('FORM-1');
  });
});

describe('valor único: permisos y privacidad', () => {
  it('prender o apagar la regla es de owner/admin; el resto de la propiedad la edita cualquiera como antes', async () => {
    const w = await workspaceWithMember('d2-admin');
    const f = await createCustomField(w.owner.id, { entity: 'contacts', name: 'vat', label: 'VAT', type: 'text' });

    session.user = asMember(w.owner, w.member);
    const post = await fieldsRoute.POST(
      json('http://x/api/crm/custom-fields', 'POST', { entity: 'contacts', name: 'code', label: 'Code', type: 'text', isUnique: true }),
    );
    expect(post.status).toBe(403);
    const patch = await fieldRoute.PATCH(json(`http://x/api/crm/custom-fields/${f.id}`, 'PATCH', { isUnique: true }), ctx(f.id));
    expect(patch.status).toBe(403);
    const desc = await fieldRoute.PATCH(json(`http://x/api/crm/custom-fields/${f.id}`, 'PATCH', { description: 'Tax id', group: 'Billing' }), ctx(f.id));
    expect(desc.status).toBe(200);

    session.user = asOwner(w.owner);
    const on = await fieldRoute.PATCH(json(`http://x/api/crm/custom-fields/${f.id}`, 'PATCH', { isUnique: true }), ctx(f.id));
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ is_unique: 1, group_name: 'Billing', description: 'Tax id' });

    session.user = null;
    expect((await fieldRoute.PATCH(json(`http://x/api/crm/custom-fields/${f.id}`, 'PATCH', { isUnique: false }), ctx(f.id))).status).toBe(401);
  });

  it('el error no dice qué registro tiene el valor cuando la persona no lo ve', async () => {
    const w = await workspaceWithMember('d2-leak');
    await setMemberVisibility(w.owner.id, 'mine');
    await createCustomField(w.owner.id, { entity: 'contacts', name: 'vat', label: 'VAT', type: 'text', isUnique: true });
    const hidden = await createContact(w.owner.id, { firstName: 'Irene', lastName: 'Privada', ownerId: w.friend.id, custom: { vat: 'SECRET-9' } });
    const mine = await createContact(w.owner.id, { firstName: 'Mora', ownerId: w.member.id });

    session.user = asMember(w.owner, w.member);
    const res = await contactRoute.PATCH(json(`http://x/api/crm/contacts/${mine.id}`, 'PATCH', { custom: { vat: 'secret-9' } }), ctx(mine.id));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'value_taken' });
    for (const leak of [hidden.id, 'Irene', 'Privada', w.friend.id]) expect(text).not.toContain(leak);

    const created = await contactsRoute.POST(json('http://x/api/crm/contacts', 'POST', { firstName: 'Nuevo', custom: { vat: 'SECRET-9' } }));
    expect(created.status).toBe(400);
    expect(await created.json()).toEqual({ error: 'value_taken' });
  });
});

describe('propiedades de fábrica del deal: tipo, próximo paso y motivo de ganado', () => {
  it('se crean, se editan, se filtran y quedan en el historial', async () => {
    const ws = (await makeUser('d2-deal')).id;
    const { pipelineId, stageId } = await pipeline(ws);
    const res = await createDeal(ws, { name: 'Renovación', pipelineId, stageId, dealType: 'existingbusiness', nextStep: 'Send the proposal' });
    if (!res.ok) throw new Error('deal');
    expect(res.deal).toMatchObject({ deal_type: 'existingbusiness', next_step: 'Send the proposal', won_reason: '' });
    const other = await createDeal(ws, { name: 'Nuevo', pipelineId, stageId, dealType: 'newbusiness' });
    if (!other.ok) throw new Error('deal');

    const upd = await updateDeal(ws, res.deal.id, { wonReason: 'Best price', dealType: 'newbusiness' }, 'ana@example.test');
    expect(upd).toMatchObject({ won_reason: 'Best price', deal_type: 'newbusiness' });

    const filtered = await listDeals(ws, { pipelineId, filters: [{ f: 'nextStep', o: 'contains', v: 'proposal' }] });
    expect(filtered.rows.map((r) => r.name)).toEqual(['Renovación']);

    const events = (await getDb()
      .prepare('SELECT field, old_value, new_value FROM crm_property_events WHERE entity_id = ? ORDER BY field')
      .all(res.deal.id)) as Array<{ field: string; old_value: string; new_value: string }>;
    expect(events).toEqual([
      { field: 'deal_type', old_value: 'existingbusiness', new_value: 'newbusiness' },
      { field: 'won_reason', old_value: '', new_value: 'Best price' },
    ]);
  });

  it('la API valida el tipo', () => {
    expect(dealUpdateSchema.safeParse({ dealType: 'newbusiness' }).success).toBe(true);
    expect(dealUpdateSchema.safeParse({ dealType: '' }).success).toBe(true);
    // Una clave con forma de opción pasa el schema; que sea una opción activa del workspace lo chequea el guardado (C5).
    expect(dealUpdateSchema.safeParse({ dealType: 'opt_abc123' }).success).toBe(true);
    expect(dealUpdateSchema.safeParse({ dealType: 'not valid!' }).success).toBe(false);
    expect(dealUpdateSchema.safeParse({ dealType: 'x'.repeat(41) }).success).toBe(false);
  });

  it('PATCH de la ficha guarda el tipo y el próximo paso', async () => {
    const w = await workspaceWithMember('d2-deal-route');
    const { pipelineId, stageId } = await pipeline(w.owner.id);
    const res = await createDeal(w.owner.id, { name: 'Ruta', pipelineId, stageId, ownerId: w.member.id });
    if (!res.ok) throw new Error('deal');
    session.user = asMember(w.owner, w.member);
    const patch = await dealRoute.PATCH(
      json(`http://x/api/crm/deals/${res.deal.id}`, 'PATCH', { dealType: 'newbusiness', nextStep: 'Demo on Monday' }),
      ctx(res.deal.id),
    );
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ deal_type: 'newbusiness', next_step: 'Demo on Monday' });
  });
});

describe('historial de propiedades con los permisos de la ficha', () => {
  async function setup() {
    const w = await workspaceWithMember('d2-history');
    await setMemberVisibility(w.owner.id, 'mine');
    const secretField = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'text' });
    await setFieldPermissions(w.owner.id, secretField.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    const hiddenCo = await createCompany(w.owner.id, { name: 'Compañía Oculta', ownerId: w.friend.id });
    const hidden = await createContact(w.owner.id, { firstName: 'Irene', ownerId: w.friend.id });
    await updateContact(w.owner.id, hidden.id, { jobTitle: 'Head of Secrets' }, undefined, 'owner@example.test');
    const mine = await createContact(w.owner.id, { firstName: 'Mora', ownerId: w.member.id });
    await updateContact(
      w.owner.id,
      mine.id,
      { jobTitle: 'Buyer', companyId: hiddenCo.id, custom: { salary: '99999' } },
      undefined,
      'owner@example.test',
    );
    return { w, hidden, mine };
  }
  const get = (entity: string, id: string) =>
    historyRoute.GET(new NextRequest(`http://x/api/crm/history?entity=${entity}&entityId=${id}`));

  it('un registro que la persona no ve da 404, sin valores', async () => {
    const { w, hidden } = await setup();
    session.user = asMember(w.owner, w.member);
    const res = await get('contact', hidden.id);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Head of Secrets');
    session.user = asOwner(w.owner);
    expect(JSON.stringify(await (await get('contact', hidden.id)).json())).toContain('Head of Secrets');
  });

  it('en un registro propio no muestra los campos ocultos ni el nombre de una empresa que no ve', async () => {
    const { w, mine } = await setup();
    session.user = asMember(w.owner, w.member);
    const res = await get('contact', mine.id);
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = JSON.parse(text) as Array<{ field: string; newValue: string }>;
    expect(events.map((e) => e.field).sort()).toEqual(['company_id', 'job_title']);
    expect(text).not.toContain('99999');
    expect(text).not.toContain('Compañía Oculta');

    session.user = asOwner(w.owner);
    const all = await (await get('contact', mine.id)).text();
    expect(all).toContain('99999');
    expect(all).toContain('Compañía Oculta');
  });

  it('sin sesión, 401', async () => {
    const { mine } = await setup();
    expect((await get('contact', mine.id)).status).toBe(401);
  });
});

describe('valor único: revisión', () => {
  it('un número guardado como texto cuenta igual que el número', async () => {
    const ws = (await makeUser('d2-numtext')).id;
    await createCustomField(ws, { entity: 'contacts', name: 'ext', label: 'Ext', type: 'number', isUnique: true });
    await createContact(ws, { firstName: 'A', custom: { ext: '123' } });
    expect(await rejection(createContact(ws, { firstName: 'B', custom: { ext: 123 } }))).toBeInstanceOf(CrmUniqueValueError);
    expect(await rejection(createContact(ws, { firstName: 'C', custom: { ext: ' 123 ' } }))).toBeInstanceOf(CrmUniqueValueError);
    expect(await createContact(ws, { firstName: 'D', custom: { ext: 0 } })).toMatchObject({ first_name: 'D' });
  });

  it('import: la fila con valor repetido no deja creada su empresa', async () => {
    const ws = (await makeUser('d2-import-co')).id;
    await createCustomField(ws, { entity: 'contacts', name: 'vat', label: 'VAT', type: 'text', isUnique: true });
    await createContact(ws, { firstName: 'X', custom: { vat: 'CO-1' } });
    const res = await importContacts(ws, [{ email: 'fila@import.test', companyName: 'Empresa Fantasma', custom: { vat: 'co-1' } }], 'skip');
    expect(res.errors).toHaveLength(1);
    const co = (await getDb()
      .prepare("SELECT COUNT(*) AS c FROM crm_companies WHERE user_id = ? AND name = 'Empresa Fantasma'")
      .get(ws)) as { c: number };
    expect(co.c).toBe(0);
  });
});
