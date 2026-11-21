/**
 * CRM, bloque D3b: formulario de alta configurable (qué propiedades, orden y
 * obligatorias), con los permisos por campo, y las propiedades de deal en la
 * edición en masa y el import. Los datos son inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCustomField, createPipeline, createStage, getDeal } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { getCreateForm, resolveCreateForm, setCreateForm } from '@/lib/crm-create-form';
import {
  DEFAULT_CREATE_FORM,
  isRequirable,
  missingRequired,
  sanitizeCreateForm,
} from '@/lib/crm-create-form-shared';
import { buildBulkPatch } from '@/lib/crm-bulk';
import { importDeals, importDealType } from '@/lib/crm-import';
import { guessMapping, hubspotMapping } from '@/components/crm/csv';
import { createFormBody } from '@/components/crm/formPayload';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (orig) => ({ ...((await orig()) as object), after: () => undefined }));

const formRoute = await import('@/app/api/crm/create-form/route');
const contactsRoute = await import('@/app/api/crm/contacts/route');
const companiesRoute = await import('@/app/api/crm/companies/route');
const dealsRoute = await import('@/app/api/crm/deals/route');

beforeEach(() => {
  session.user = null;
});

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (url: string) => new NextRequest(url);

describe('formulario de alta: reglas puras', () => {
  const customs = new Map([
    ['plan', 'select'],
    ['vip', 'boolean'],
  ]);

  it('limpia: claves conocidas, sin repetir, base solo si es obligatoria y nunca la que ya lo es', () => {
    const out = sanitizeCreateForm(
      'deals',
      [
        { key: 'amount', required: true },
        { key: 'amount', required: false },
        { key: 'nope' },
        { key: 'custom.ghost' },
        { key: 'name', required: true },
        { key: 'custom.plan', required: true },
        { key: 'custom.vip', required: true },
        { key: 'dealType' },
        { key: 42 },
      ],
      customs,
    );
    expect(out).toEqual([
      { key: 'amount', required: true },
      { key: 'custom.plan', required: true },
      { key: 'custom.vip', required: false },
      { key: 'dealType', required: false },
    ]);
  });

  it('la base de contactos se puede pedir obligatoria y queda arriba', () => {
    expect(
      sanitizeCreateForm('contacts', [{ key: 'phone' }, { key: 'email', required: true }, { key: 'firstName', required: false }], customs),
    ).toEqual([
      { key: 'email', required: true },
      { key: 'phone', required: false },
    ]);
    expect(isRequirable('contacts', 'email')).toBe(true);
    expect(isRequirable('companies', 'name')).toBe(false);
    expect(isRequirable('deals', 'custom.vip', 'boolean')).toBe(false);
  });

  it('missingRequired mira el body tal como se envía', () => {
    const form = [
      { key: 'amount', required: true },
      { key: 'contactId', required: true },
      { key: 'custom.plan', required: true },
      { key: 'closeDate', required: false },
    ];
    expect(missingRequired('deals', form, { amount: 0, contactIds: ['c1'], custom: { plan: 'Pro' } })).toEqual([]);
    expect(missingRequired('deals', form, { amount: undefined, contactIds: [], custom: { plan: '  ' } })).toEqual([
      'amount',
      'contactId',
      'custom.plan',
    ]);
  });

  it('createFormBody lee solo las propiedades del formulario', () => {
    const fd = new FormData();
    fd.set('amount', '1500');
    fd.set('currency', 'eur');
    fd.set('dealType', 'newbusiness');
    fd.set('nextStep', ' Call ');
    fd.set('contactId', 'c1');
    fd.set('custom.plan', 'Pro');
    fd.set('priority', 'high');
    const body = createFormBody('deals', fd, [
      { key: 'amount' },
      { key: 'currency' },
      { key: 'dealType' },
      { key: 'nextStep' },
      { key: 'contactId' },
      { key: 'custom.plan', custom: { name: 'plan', label: 'Plan', type: 'select', options: ['Pro'] } },
    ]);
    expect(body).toEqual({
      amount: 1500,
      currency: 'EUR',
      dealType: 'newbusiness',
      nextStep: 'Call',
      contactIds: ['c1'],
      custom: { plan: 'Pro' },
    });
  });
});

describe('formulario de alta: configuración y permisos', () => {
  async function setup(label: string) {
    const w = await workspaceWithMember(label);
    const plan = await createCustomField(w.owner.id, { entity: 'contacts', name: 'plan', label: 'Plan', type: 'text' });
    const secret = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary band', type: 'text' });
    const po = await createCustomField(w.owner.id, { entity: 'contacts', name: 'po', label: 'PO number', type: 'text' });
    await setFieldPermissions(w.owner.id, secret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    await setFieldPermissions(w.owner.id, po.id, [{ subject: MEMBER_SUBJECT, access: 'read' }]);
    return { w, plan, secret, po };
  }

  it('sin configurar usa el de por defecto; owner y admin lo cambian, member no', async () => {
    const { w } = await setup('d3b-cfg');
    expect(await getCreateForm(w.owner.id, 'contacts')).toEqual(DEFAULT_CREATE_FORM.contacts);

    session.user = null;
    expect((await formRoute.PUT(json('http://x/api/crm/create-form', 'PUT', { entity: 'contacts', fields: [] }))).status).toBe(401);

    session.user = asMember(w.owner, w.member);
    const denied = await formRoute.PUT(
      json('http://x/api/crm/create-form', 'PUT', { entity: 'contacts', fields: [{ key: 'jobTitle', required: true }] }),
    );
    expect(denied.status).toBe(403);
    expect((await formRoute.DELETE(get('http://x/api/crm/create-form?entity=contacts'))).status).toBe(403);
    expect(await getCreateForm(w.owner.id, 'contacts')).toEqual(DEFAULT_CREATE_FORM.contacts);

    session.user = asMember(w.owner, w.member, 'admin');
    const ok = await formRoute.PUT(
      json('http://x/api/crm/create-form', 'PUT', {
        entity: 'contacts',
        fields: [{ key: 'jobTitle', required: true }, { key: 'custom.plan', required: true }, { key: 'phone' }],
      }),
    );
    expect(ok.status).toBe(200);
    expect(await getCreateForm(w.owner.id, 'contacts')).toEqual([
      { key: 'jobTitle', required: true },
      { key: 'custom.plan', required: true },
      { key: 'phone', required: false },
    ]);

    // Otro workspace no ve ni toca esta configuración.
    session.user = asOwner(w.stranger);
    const other = (await (await formRoute.GET(get('http://x/api/crm/create-form?entity=contacts'))).json()) as {
      fields: Array<{ key: string }>;
    };
    expect(other.fields.map((f) => f.key)).toEqual(DEFAULT_CREATE_FORM.contacts.map((f) => f.key));

    session.user = asOwner(w.owner);
    expect((await formRoute.DELETE(get('http://x/api/crm/create-form?entity=contacts'))).status).toBe(200);
    expect(await getCreateForm(w.owner.id, 'contacts')).toEqual(DEFAULT_CREATE_FORM.contacts);
    expect((await formRoute.GET(get('http://x/api/crm/create-form?entity=leads'))).status).toBe(400);
  });

  it('un member no recibe ni se le exige lo que tiene oculto o de solo lectura', async () => {
    const { w } = await setup('d3b-perm');
    await setCreateForm(w.owner.id, 'contacts', [
      { key: 'custom.salary', required: true },
      { key: 'custom.po', required: true },
      { key: 'custom.plan', required: true },
    ]);
    const member = { workspaceId: w.owner.id, personId: w.member.id, role: 'member' as const };
    expect((await resolveCreateForm(member, 'contacts')).map((f) => f.key)).toEqual(['custom.plan']);
    const owner = { workspaceId: w.owner.id, personId: w.owner.id, role: 'owner' as const };
    expect((await resolveCreateForm(owner, 'contacts')).map((f) => f.key)).toEqual(['custom.salary', 'custom.po', 'custom.plan']);

    session.user = asMember(w.owner, w.member);
    const text = await (await formRoute.GET(get('http://x/api/crm/create-form?entity=contacts'))).text();
    for (const leak of ['salary', 'Salary band', 'PO number']) expect(text).not.toContain(leak);

    // Falta la única obligatoria que ve: 400 sin nombrar las ocultas.
    const missing = await contactsRoute.POST(json('http://x/api/crm/contacts', 'POST', { createForm: true, firstName: 'Ana' }));
    expect(missing.status).toBe(400);
    const body = (await missing.json()) as { error: string; fields: string[]; labels: Record<string, string> };
    expect(body).toEqual({ error: 'missing_required', fields: ['custom.plan'], labels: { 'custom.plan': 'Plan' } });

    const created = await contactsRoute.POST(json('http://x/api/crm/contacts', 'POST', { createForm: true, firstName: 'Ana', custom: { plan: 'Pro' } }));
    expect(created.status).toBe(201);

    // Otras altas de la app (guardar un contacto desde un chat, el MCP) no pasan por el formulario.
    expect((await contactsRoute.POST(json('http://x/api/crm/contacts', 'POST', { firstName: 'Chat' }))).status).toBe(201);

    // El owner sí tiene que completar las tres.
    session.user = asOwner(w.owner);
    const ownerMissing = (await (
      await contactsRoute.POST(json('http://x/api/crm/contacts', 'POST', { createForm: true, firstName: 'Ana', custom: { plan: 'Pro' } }))
    ).json()) as { fields: string[] };
    expect(ownerMissing.fields).toEqual(['custom.salary', 'custom.po']);
  });

  it('empresas y deals: las obligatorias propias se exigen en la ruta de la app', async () => {
    const w = await workspaceWithMember('d3b-deal');
    await setCreateForm(w.owner.id, 'companies', [{ key: 'domain', required: true }, { key: 'industry', required: true }]);
    await setCreateForm(w.owner.id, 'deals', [{ key: 'amount', required: true }, { key: 'dealType', required: true }]);
    session.user = asMember(w.owner, w.member);

    const co = await companiesRoute.POST(json('http://x/api/crm/companies', 'POST', { createForm: true, name: 'Acme' }));
    expect(co.status).toBe(400);
    expect(((await co.json()) as { fields: string[] }).fields).toEqual(['domain', 'industry']);
    expect(
      (await companiesRoute.POST(json('http://x/api/crm/companies', 'POST', { createForm: true, name: 'Acme', domain: 'acme.test', industry: 'Retail' })))
        .status,
    ).toBe(201);

    const p = await createPipeline(w.owner.id, 'Ventas');
    const s = await createStage(w.owner.id, p.id, { name: 'Abierto' });
    const base = { pipelineId: p.id, stageId: s!.id, name: 'Renovación' };
    const deal = await dealsRoute.POST(json('http://x/api/crm/deals', 'POST', { ...base, createForm: true }));
    expect(((await deal.json()) as { fields: string[] }).fields).toEqual(['amount', 'dealType']);
    const ok = await dealsRoute.POST(
      json('http://x/api/crm/deals', 'POST', { createForm: true, ...base, amount: 0, dealType: 'existingbusiness', nextStep: 'Demo', wonReason: 'Precio' }),
    );
    expect(ok.status).toBe(201);
    const row = (await getDeal(w.owner.id, ((await ok.json()) as { id: string }).id))!;
    expect(row.deal).toMatchObject({ deal_type: 'existingbusiness', next_step: 'Demo', won_reason: 'Precio' });
  });
});

describe('deal type, next step y won reason: edición en masa e import', () => {
  it('la edición en masa los acepta y los vacía', () => {
    expect(buildBulkPatch('deal', 'dealType', 'newbusiness')).toEqual({ kind: 'field', patch: { dealType: 'newbusiness' } });
    expect(buildBulkPatch('deal', 'dealType', null)).toEqual({ kind: 'field', patch: { dealType: '' } });
    expect(buildBulkPatch('deal', 'dealType', 'otro')).toBeNull();
    expect(buildBulkPatch('deal', 'nextStep', 'Llamar')).toEqual({ kind: 'field', patch: { nextStep: 'Llamar' } });
    expect(buildBulkPatch('deal', 'wonReason', null)).toEqual({ kind: 'field', patch: { wonReason: '' } });
    expect(buildBulkPatch('contact', 'dealType', 'newbusiness')).toBeNull();
  });

  it('el import los mapea (también desde un export de HubSpot) y normaliza el tipo', async () => {
    expect(importDealType('New Business')).toBe('newbusiness');
    expect(importDealType('existingbusiness')).toBe('existingbusiness');
    expect(importDealType('Negocio nuevo')).toBe('newbusiness');
    expect(importDealType('raro')).toBeUndefined();
    expect(importDealType('Existing Customer - Upgrade')).toBe('existingbusiness');
    expect(importDealType('New Customer')).toBe('newbusiness');
    expect(importDealType('nuevo')).toBe('newbusiness');
    const headers = ['Deal Name', 'Deal Type', 'Next step', 'Closed won reason'];
    expect(hubspotMapping(headers, 'deals')).toEqual(['name', 'dealType', 'nextStep', 'wonReason']);
    expect(guessMapping(headers, 'deals')).toEqual(['name', 'dealType', 'nextStep', 'wonReason']);

    const w = await workspaceWithMember('d3b-import');
    const p = await createPipeline(w.owner.id, 'Ventas');
    await createStage(w.owner.id, p.id, { name: 'Abierto' });
    const res = await importDeals(
      w.owner.id,
      [
        { name: 'Import uno', dealType: 'New Business', nextStep: 'Enviar propuesta', wonReason: 'Precio' },
        { name: 'Import dos', dealType: 'raro' },
      ],
      'skip',
    );
    expect(res.created).toBe(2);
    expect(res.errors.some((e) => e.includes('deal type'))).toBe(true);
  });
});
