/**
 * CRM, bloque D3: las definiciones de campos propios que ve cada persona
 * (permisos por campo) y los labels de asociación del workspace.
 * Los datos son inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createContact, createCompany, createCustomField, createDeal, createPipeline, createStage, getContact, getDeal, updateDeal } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions, visibleFieldDefinitions, canSeeFieldDefinition } from '@/lib/crm-field-perms';
import { createSalesTeam, setMemberVisibility } from '@/lib/crm-visibility';
import { associate, associateContactCompany, listAssociations } from '@/lib/crm-assoc';
import {
  assocLabelOptions,
  createAssociationLabel,
  customLabelValue,
  deleteAssociationLabel,
  listAssociationLabels,
  resolveAssocLabel,
} from '@/lib/crm-assoc-labels';
import { CrmRefError } from '@/lib/crm-refs';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const fieldsRoute = await import('@/app/api/crm/custom-fields/route');
const fieldRoute = await import('@/lib/routes/crm/custom-fields/[id]/route');
const labelsRoute = await import('@/app/api/crm/association-labels/route');
const assocRoute = await import('@/app/api/crm/associations/route');
const actions = await import('@/components/crm/associationActions');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (url: string) => new NextRequest(url);

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

async function deal(ws: string, name: string, extra: Partial<Parameters<typeof createDeal>[1]> = {}) {
  const { pipelineId, stageId } = await pipeline(ws);
  const res = await createDeal(ws, { name, pipelineId, stageId, ...extra });
  if (!res.ok) throw new Error('deal');
  return res.deal;
}

describe('definiciones de campos propios: cada persona ve las que tiene permitidas', () => {
  async function setup(label: string) {
    const w = await workspaceWithMember(label);
    const open = await createCustomField(w.owner.id, { entity: 'contacts', name: 'plan', label: 'Plan', type: 'text' });
    const readOnly = await createCustomField(w.owner.id, { entity: 'deals', name: 'po', label: 'PO', type: 'text' });
    const secret = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'text' });
    const teamOnly = await createCustomField(w.owner.id, { entity: 'companies', name: 'margin', label: 'Margin', type: 'number' });
    await setFieldPermissions(w.owner.id, readOnly.id, [{ subject: MEMBER_SUBJECT, access: 'read' }]);
    await setFieldPermissions(w.owner.id, secret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    const team = await createSalesTeam(w.owner.id, { name: 'SDR', members: [w.friend.id] });
    await setFieldPermissions(w.owner.id, teamOnly.id, [{ subject: `team:${team.id}`, access: 'hidden' }]);
    return { w, open, readOnly, secret, teamOnly };
  }

  it('GET sin entidad: el member no recibe los ocultos; owner y admin reciben todos', async () => {
    const { w, secret, teamOnly } = await setup('d3-defs');
    const names = async (user: SessionUser) => {
      session.user = user;
      const res = await fieldsRoute.GET(get('http://x/api/crm/custom-fields'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rows: Array<{ id: string; name: string }> };
      return body.rows.map((r) => r.name).sort();
    };
    expect(await names(asOwner(w.owner))).toEqual(['margin', 'plan', 'po', 'salary']);
    expect(await names(asMember(w.owner, w.member, 'admin'))).toEqual(['margin', 'plan', 'po', 'salary']);
    // member: ve el de solo lectura, no el oculto para su rol.
    expect(await names(asMember(w.owner, w.member))).toEqual(['margin', 'plan', 'po']);
    // friend está en el equipo al que se le oculta "margin".
    expect(await names(asMember(w.owner, w.friend))).toEqual(['plan', 'po']);

    session.user = asMember(w.owner, w.member);
    const text = await (await fieldsRoute.GET(get('http://x/api/crm/custom-fields'))).text();
    for (const leak of [secret.id, 'Salary']) expect(text).not.toContain(leak);
    session.user = asMember(w.owner, w.friend);
    expect(await (await fieldsRoute.GET(get('http://x/api/crm/custom-fields'))).text()).not.toContain(teamOnly.id);
  });

  it('GET con entidad sigue igual, y anónimo u otro workspace no ven nada', async () => {
    const { w } = await setup('d3-defs-entity');
    session.user = asMember(w.owner, w.member);
    const res = await fieldsRoute.GET(get('http://x/api/crm/custom-fields?entity=contacts'));
    expect(((await res.json()) as { rows: Array<{ name: string }> }).rows.map((r) => r.name)).toEqual(['plan']);

    session.user = null;
    expect((await fieldsRoute.GET(get('http://x/api/crm/custom-fields'))).status).toBe(401);
    session.user = asOwner(w.stranger);
    expect(((await (await fieldsRoute.GET(get('http://x/api/crm/custom-fields'))).json()) as { rows: unknown[] }).rows).toEqual([]);
  });

  it('visibleFieldDefinitions y canSeeFieldDefinition aplican la regla más estricta', async () => {
    const { w, secret, readOnly } = await setup('d3-defs-lib');
    const member = { workspaceId: w.owner.id, personId: w.member.id, role: 'member' as const };
    const owner = { workspaceId: w.owner.id, personId: w.owner.id, role: 'owner' as const };
    expect((await visibleFieldDefinitions(member)).map((d) => d.name)).not.toContain('salary');
    expect((await visibleFieldDefinitions(owner)).map((d) => d.name)).toContain('salary');
    expect(await canSeeFieldDefinition(member, secret.id)).toBe(false);
    expect(await canSeeFieldDefinition(member, readOnly.id)).toBe(true);
    expect(await canSeeFieldDefinition(owner, secret.id)).toBe(true);
    // Un campo de otro workspace no existe para nadie de este.
    const other = await createCustomField(w.stranger.id, { entity: 'contacts', name: 'x', label: 'X', type: 'text' });
    expect(await canSeeFieldDefinition(owner, other.id)).toBe(false);
  });

  it('PATCH de un campo oculto responde 404 al member y no lo cambia', async () => {
    const { w, secret, readOnly } = await setup('d3-defs-patch');
    session.user = asMember(w.owner, w.member);
    const hidden = await fieldRoute.PATCH(
      json(`http://x/api/crm/custom-fields/${secret.id}`, 'PATCH', { label: 'Renamed' }),
      ctx(secret.id),
    );
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain('Salary');
    const row = (await getDb().prepare('SELECT label FROM crm_custom_fields WHERE id = ?').get(secret.id)) as { label: string };
    expect(row.label).toBe('Salary');
    // El de solo lectura (valores) sigue siendo una definición visible.
    const visible = await fieldRoute.PATCH(json(`http://x/api/crm/custom-fields/${readOnly.id}`, 'PATCH', { label: 'PO number' }), ctx(readOnly.id));
    expect(visible.status).toBe(200);
    session.user = asOwner(w.owner);
    const owner = await fieldRoute.PATCH(json(`http://x/api/crm/custom-fields/${secret.id}`, 'PATCH', { label: 'Pay' }), ctx(secret.id));
    expect(owner.status).toBe(200);
  });
});

describe('labels de asociación: validación pura', () => {
  it('acepta las claves de fábrica solo en contacto ↔ empresa y los propios del par', () => {
    const ids = new Set(['l1']);
    expect(resolveAssocLabel('contact_company', 'billing', ids)).toBe('billing');
    expect(resolveAssocLabel('contact_company', '', ids)).toBe('');
    expect(resolveAssocLabel('deal_contact', null, ids)).toBe('');
    expect(resolveAssocLabel('deal_contact', 'custom:l1', ids)).toBe('custom:l1');
    expect(() => resolveAssocLabel('deal_contact', 'billing', ids)).toThrow(CrmRefError);
    expect(() => resolveAssocLabel('contact_company', 'custom:otro', ids)).toThrow('invalid_label');
    expect(() => resolveAssocLabel('contact_company', 'Billing', ids)).toThrow('invalid_label');
  });

  it('arma las opciones: de fábrica primero, después las del par', () => {
    const custom = [
      { id: 'a', name: 'Decisor', pair: 'deal_contact' as const },
      { id: 'b', name: 'Facturación', pair: 'contact_company' as const },
    ];
    const cc = assocLabelOptions('contact_company', custom, (k) => k.toUpperCase());
    expect(cc[0]).toEqual({ value: 'employee', label: 'EMPLOYEE' });
    expect(cc.at(-1)).toEqual({ value: 'custom:b', label: 'Facturación' });
    expect(assocLabelOptions('deal_contact', custom, (k) => k)).toEqual([{ value: 'custom:a', label: 'Decisor' }]);
  });
});

describe('labels de asociación: datos y permisos', () => {
  it('solo owner y admin los crean, renombran y borran; cualquiera del workspace los lee', async () => {
    const w = await workspaceWithMember('d3-labels-route');
    session.user = asMember(w.owner, w.member);
    expect((await labelsRoute.POST(json('http://x', 'POST', { pair: 'deal_contact', name: 'Decisor' }))).status).toBe(403);

    session.user = asMember(w.owner, w.friend, 'admin');
    const created = await labelsRoute.POST(json('http://x', 'POST', { pair: 'deal_contact', name: 'Decisor' }));
    expect(created.status).toBe(201);
    const label = (await created.json()) as { id: string; name: string };
    expect((await labelsRoute.POST(json('http://x', 'POST', { pair: 'deal_contact', name: ' decisor ' }))).status).toBe(400);
    expect((await labelsRoute.POST(json('http://x', 'POST', { pair: 'contact_deal', name: 'X' }))).status).toBe(400);

    session.user = asMember(w.owner, w.member);
    const list = await labelsRoute.GET(get('http://x/api/crm/association-labels?pair=deal_contact'));
    expect(((await list.json()) as { rows: Array<{ name: string }> }).rows.map((r) => r.name)).toEqual(['Decisor']);
    expect((await labelsRoute.PATCH(json('http://x', 'PATCH', { id: label.id, name: 'Otro' }))).status).toBe(403);
    expect((await labelsRoute.DELETE(get(`http://x/api/crm/association-labels?id=${label.id}`))).status).toBe(403);

    // Otro workspace no ve, ni renombra ni borra el label.
    session.user = asOwner(w.stranger);
    expect(((await (await labelsRoute.GET(get('http://x/api/crm/association-labels'))).json()) as { rows: unknown[] }).rows).toEqual([]);
    expect((await labelsRoute.PATCH(json('http://x', 'PATCH', { id: label.id, name: 'Robado' }))).status).toBe(404);
    expect((await labelsRoute.DELETE(get(`http://x/api/crm/association-labels?id=${label.id}`))).status).toBe(404);

    session.user = null;
    expect((await labelsRoute.GET(get('http://x/api/crm/association-labels'))).status).toBe(401);

    session.user = asOwner(w.owner);
    const renamed = await labelsRoute.PATCH(json('http://x', 'PATCH', { id: label.id, name: 'Quien decide' }));
    expect(await renamed.json()).toMatchObject({ name: 'Quien decide' });
    expect((await labelsRoute.DELETE(get(`http://x/api/crm/association-labels?id=${label.id}`))).status).toBe(204);
  });

  it('deal ↔ contacto: se guarda, se lista en las dos puntas y sobrevive a cambiar los contactos', async () => {
    const ws = (await makeUser('d3-labels-deal')).id;
    const decisor = await createAssociationLabel(ws, 'deal_contact', 'Decisor');
    const a = await createContact(ws, { firstName: 'Ana' });
    const b = await createContact(ws, { firstName: 'Beto' });
    const d = await deal(ws, 'Renovación', { contactIds: [a.id] });

    await associate(ws, { fromType: 'contact', fromId: a.id, toType: 'deal', toId: d.id, label: customLabelValue(decisor.id) });
    expect((await listAssociations(ws, 'deal', d.id))?.contacts).toEqual([
      expect.objectContaining({ id: a.id, label: customLabelValue(decisor.id) }),
    ]);
    expect((await listAssociations(ws, 'contact', a.id))?.deals?.[0]).toMatchObject({ id: d.id, label: customLabelValue(decisor.id) });
    expect((await getContact(ws, a.id))?.deals[0].assoc_label).toBe(customLabelValue(decisor.id));

    await updateDeal(ws, d.id, { contactIds: [b.id, a.id] }, 'owner@example.test');
    const detail = await getDeal(ws, d.id);
    expect(detail?.contacts.map((c) => [c.id, c.assoc_label])).toEqual([
      [b.id, ''],
      [a.id, customLabelValue(decisor.id)],
    ]);

    // Un label de fábrica de contacto ↔ empresa no vale para deal ↔ contacto.
    expect(await rejection(associate(ws, { fromType: 'deal', fromId: d.id, toType: 'contact', toId: b.id, label: 'billing' }))).toBeInstanceOf(
      CrmRefError,
    );
  });

  it('no acepta labels de otro workspace ni de otro par', async () => {
    const ws = (await makeUser('d3-labels-cross')).id;
    const other = (await makeUser('d3-labels-cross-other')).id;
    const foreign = await createAssociationLabel(other, 'contact_company', 'Ajeno');
    const dealLabel = await createAssociationLabel(ws, 'deal_contact', 'Decisor');
    const c = await createContact(ws, { firstName: 'Ana' });
    const co = await createCompany(ws, { name: 'Acme' });
    expect(await rejection(associateContactCompany(ws, c.id, co.id, { label: customLabelValue(foreign.id) }))).toMatchObject({
      code: 'invalid_label',
    });
    expect(await rejection(associateContactCompany(ws, c.id, co.id, { label: customLabelValue(dealLabel.id) }))).toMatchObject({
      code: 'invalid_label',
    });
    const mine = await createAssociationLabel(ws, 'contact_company', 'Facturación');
    await associateContactCompany(ws, c.id, co.id, { label: customLabelValue(mine.id) });
    expect((await listAssociations(ws, 'contact', c.id))?.companies?.[0].label).toBe(customLabelValue(mine.id));
  });

  it('al borrar un label, las asociaciones que lo usaban quedan sin label', async () => {
    const ws = (await makeUser('d3-labels-delete')).id;
    const cc = await createAssociationLabel(ws, 'contact_company', 'Facturación');
    const dc = await createAssociationLabel(ws, 'deal_contact', 'Decisor');
    const c = await createContact(ws, { firstName: 'Ana' });
    const co = await createCompany(ws, { name: 'Acme' });
    const d = await deal(ws, 'Uno', { contactIds: [c.id] });
    await associateContactCompany(ws, c.id, co.id, { label: customLabelValue(cc.id) });
    await associate(ws, { fromType: 'deal', fromId: d.id, toType: 'contact', toId: c.id, label: customLabelValue(dc.id) });

    expect(await deleteAssociationLabel(ws, cc.id)).toBe(true);
    expect(await deleteAssociationLabel(ws, dc.id)).toBe(true);
    const assoc = await listAssociations(ws, 'contact', c.id);
    expect(assoc?.companies?.[0].label).toBe('');
    expect(assoc?.deals?.[0].label).toBe('');
    expect(await listAssociationLabels(ws)).toEqual([]);
    expect(await deleteAssociationLabel(ws, cc.id)).toBe(false);
  });

  it('respeta la visibilidad por owner al poner un label (API y ficha)', async () => {
    const w = await workspaceWithMember('d3-labels-scope');
    await setMemberVisibility(w.owner.id, 'mine');
    const label = await createAssociationLabel(w.owner.id, 'deal_contact', 'Decisor');
    const value = customLabelValue(label.id);
    const theirs = await createContact(w.owner.id, { firstName: 'Irene', ownerId: w.friend.id });
    const mine = await createContact(w.owner.id, { firstName: 'Mora', ownerId: w.member.id });
    const hiddenDeal = await deal(w.owner.id, 'Oculto', { ownerId: w.friend.id, contactIds: [theirs.id, mine.id] });
    const myDeal = await deal(w.owner.id, 'Mío', { ownerId: w.member.id, contactIds: [mine.id] });

    session.user = asMember(w.owner, w.member);
    const res = await assocRoute.POST(
      json('http://x/api/crm/associations', 'POST', { fromType: 'deal', fromId: hiddenDeal.id, toType: 'contact', toId: mine.id, label: value }),
    );
    expect(res.status).toBe(404);
    expect(await rejection(actions.setDealContactLabel(hiddenDeal.id, mine.id, value))).toBeInstanceOf(Error);
    // Cambiar el label no crea una asociación que no existía.
    expect(await rejection(actions.setDealContactLabel(myDeal.id, theirs.id, value))).toBeInstanceOf(Error);
    await actions.setDealContactLabel(myDeal.id, mine.id, value);

    const rows = (await getDb()
      .prepare('SELECT deal_id, contact_id, label FROM crm_deal_contacts WHERE deal_id IN (?, ?) ORDER BY deal_id, contact_id')
      .all(hiddenDeal.id, myDeal.id)) as Array<{ deal_id: string; contact_id: string; label: string }>;
    expect(rows.filter((r) => r.label)).toEqual([{ deal_id: myDeal.id, contact_id: mine.id, label: value }]);
    expect(rows.some((r) => r.deal_id === myDeal.id && r.contact_id === theirs.id)).toBe(false);
  });
});
