/**
 * CRM, tercera pasada: lo que sale por webhooks y flows sigue el acceso de
 * quien creó la suscripción (registros de su alcance, sin campos ocultos ni
 * en `custom` ni en `change.changed` ni en form.submitted), también al
 * reintentar; un id huérfano se ve igual para todos (sin asociado, sin
 * "Registro privado"); la tabla y el CSV de envíos no llevan la columna de un
 * campo oculto; y un workflow que nombra un campo oculto no existe para quien
 * lo tiene oculto. Miradas: owner, admin, miembro con "mine", miembro de un
 * equipo de ventas y otro workspace. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, createDeal, createPipeline, createStage, deleteContact, listContacts, updateContact } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { createSalesTeam, setMemberVisibility } from '@/lib/crm-visibility';
import { maskPrivateRefs, PRIVATE_REFS } from '@/lib/crm-record-scope';
import { crmPersonalizer, deliveryPayloadFor } from '@/lib/crm-event-privacy';
import { createForm, submissionFieldsFor, submitForm } from '@/lib/crm-forms';
import type { FormField } from '@/lib/crm-forms-schema';
import { createWorkflow, listRecordEnrollments, workflowsForViewer } from '@/lib/crm-workflows';
import { workflowUsesHiddenField } from '@/lib/crm-workflow-rules';
import { resendDelivery } from '@/lib/webhooks';
import { addMember, removeMember, setMemberRole } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { seal } from '@/lib/secret-box';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const submissionsRoute = await import('@/lib/routes/crm/forms/[id]/submissions/route');
const workflowsRoute = await import('@/app/api/crm/workflows/route');
const workflowRoute = await import('@/lib/routes/crm/workflows/[id]/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new NextRequest(url);
const json = async <T,>(res: Response) => (await res.json()) as T;

/**
 * Workspace con un admin de verdad (rol en el equipo), `secret` (contactos,
 * empresas, deals) oculto para el rol member y `tier` (contactos) oculto solo
 * para el equipo de ventas de `friend`. Visibilidad "mine".
 */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  for (const entity of ['contacts', 'companies', 'deals']) {
    const f = await createCustomField(ws, { entity, name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(ws, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  }
  const team = await createSalesTeam(ws, { name: 'Field', members: [w.friend.id] });
  const tier = await createCustomField(ws, { entity: 'contacts', name: 'tier', label: 'Tier', type: 'text' });
  await setFieldPermissions(ws, tier.id, [{ subject: `team:${team.id}`, access: 'hidden' }]);
  const ownerCo = await createCompany(ws, { name: 'Hidden Owner Co', ownerId: ws });
  const memberContact = await createContact(ws, {
    firstName: 'Zeta',
    lastName: 'Member',
    email: 'zeta-member@example.test',
    ownerId: w.member.id,
    companyId: ownerCo.id,
    custom: { secret: 's-1', tier: 'gold' },
  });
  const friendContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Friend', ownerId: w.friend.id, custom: { tier: 'silver' } });
  const ownerContact = await createContact(ws, { firstName: 'Hidden', lastName: 'Person', ownerId: ws, custom: { secret: 's-2' } });
  return { w, ws, adminPerson, team, ownerCo, memberContact, friendContact, ownerContact };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const teamMember = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);
const viewerOf = (s: Setup, personId: string, role: 'owner' | 'admin' | 'member') => ({ workspaceId: s.ws, personId, role });

/** Webhook en la base con su creador (la URL no responde: la entrega queda registrada). */
async function hook(userId: string, createdBy: string | null, events: string[]): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO webhooks (id, user_id, url, events, secret, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, 'https://127.0.0.1/hook', JSON.stringify(events), seal('whsec_test'), createdBy);
  return id;
}

async function deliveries(hookId: string): Promise<Array<{ id: string; event: string; status: string; error: string | null; body: Record<string, unknown> }>> {
  const rows = (await getDb()
    .prepare('SELECT id, event, status, last_error, payload FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at, rowid')
    .all(hookId)) as Array<{ id: string; event: string; status: string; last_error: string | null; payload: string }>;
  return rows.map((r) => ({ id: r.id, event: r.event, status: r.status, error: r.last_error, body: JSON.parse(r.payload) as Record<string, unknown> }));
}

const dataOf = (d: { body: Record<string, unknown> }) => d.body.data as Record<string, unknown>;

/** Un webhook por cada mirada (y uno viejo sin creador). */
async function hooksFor(s: Setup, events: string[]) {
  return {
    owner: await hook(s.ws, s.ws, events),
    admin: await hook(s.ws, s.adminPerson.id, events),
    member: await hook(s.ws, s.w.member.id, events),
    team: await hook(s.ws, s.w.friend.id, events),
    stranger: await hook(s.ws, s.w.stranger.id, events),
    legacy: await hook(s.ws, null, events),
  };
}

// ---------- 1. Webhooks de registros ----------

describe('webhooks de contactos, empresas y deals', () => {
  it('contact.updated: cada webhook con lo que ve quien lo creó (custom y change.changed)', async () => {
    const s = await setup('p3-wh-contact');
    const h = await hooksFor(s, ['contact.updated', 'contact.property_changed']);
    await updateContact(s.ws, s.memberContact.id, { custom: { secret: 's-9', tier: 'platinum' } });

    for (const k of ['owner', 'admin'] as const) {
      const [upd] = (await deliveries(h[k])).filter((d) => d.event === 'contact.updated');
      expect(dataOf(upd).custom).toEqual({ secret: 's-9', tier: 'platinum' });
      expect((dataOf(upd).change as { changed: string[] }).changed).toEqual(expect.arrayContaining(['custom.secret', 'custom.tier']));
      const props = (await deliveries(h[k])).filter((d) => d.event === 'contact.property_changed').map((d) => dataOf(d).property);
      expect(props).toEqual(expect.arrayContaining(['custom.secret', 'custom.tier']));
    }

    // Miembro con "mine": el contacto es suyo, pero `secret` no sale ni por nombre.
    const mine = await deliveries(h.member);
    const upd = mine.find((d) => d.event === 'contact.updated')!;
    expect(dataOf(upd).custom).toEqual({ tier: 'platinum' });
    expect((dataOf(upd).change as { changed: string[] }).changed).toEqual(['custom.tier']);
    expect(JSON.stringify(mine)).not.toContain('s-9');
    expect(JSON.stringify(mine)).not.toContain('custom.secret');
    // La empresa asociada es del owner: sin id.
    expect(dataOf(upd).company_id).toBeNull();
    expect(mine.filter((d) => d.event === 'contact.property_changed').map((d) => dataOf(d).property)).toEqual(['custom.tier']);

    // Equipo de ventas con "mine": el contacto no es de su alcance. Otro workspace y sin creador: nada.
    expect(await deliveries(h.team)).toEqual([]);
    expect(await deliveries(h.stranger)).toEqual([]);
    expect(await deliveries(h.legacy)).toEqual([]);
  });

  it('un registro fuera del alcance no le llega al miembro; el de su equipo sí, sin lo oculto para el equipo', async () => {
    const s = await setup('p3-wh-scope');
    const h = await hooksFor(s, ['contact.updated']);
    await updateContact(s.ws, s.ownerContact.id, { jobTitle: 'Lead' });
    expect(await deliveries(h.member)).toEqual([]);
    expect(await deliveries(h.team)).toEqual([]);
    expect(dataOf((await deliveries(h.owner))[0]).custom).toEqual({ secret: 's-2' });

    await updateContact(s.ws, s.friendContact.id, { jobTitle: 'Rep' });
    const [own] = await deliveries(h.team);
    // `tier` está oculto para su equipo y `secret` para el rol member.
    expect(dataOf(own).custom).toEqual({});
    expect(await deliveries(h.member)).toEqual([]);
  });

  it('company.created, deal.created y *.deleted siguen el mismo modelo', async () => {
    const s = await setup('p3-wh-other');
    const h = await hooksFor(s, ['company.created', 'deal.created', 'contact.deleted']);
    await createCompany(s.ws, { name: 'Member Co', ownerId: s.w.member.id, custom: { secret: 'co-secret' } });
    await createCompany(s.ws, { name: 'Owner Only Co', ownerId: s.ws });
    const p = await createPipeline(s.ws, 'Sales');
    const stage = (await createStage(s.ws, p.id, { name: 'Open' }))!;
    await createDeal(s.ws, { name: 'Member deal', pipelineId: p.id, stageId: stage.id, ownerId: s.w.member.id, custom: { secret: 'd-secret' } });
    await deleteContact(s.ws, s.ownerContact.id);
    await deleteContact(s.ws, s.memberContact.id);

    const mine = await deliveries(h.member);
    expect(mine.map((d) => d.event).sort()).toEqual(['company.created', 'contact.deleted', 'deal.created']);
    // Se intentan (la URL no responde), no se descartan por acceso.
    expect(mine.every((d) => d.error !== 'audience_revoked')).toBe(true);
    // Al reenviar un borrado, el owner sale de la papelera: el del miembro se reenvía, no se descarta.
    const del = mine.find((d) => d.event === 'contact.deleted')!;
    const again = await resendDelivery(s.ws, del.id);
    expect((await deliveries(h.member)).find((d) => d.id === again)!.error).not.toBe('audience_revoked');
    expect(await deliveryPayloadFor(s.ws, s.w.member.id, 'contact.deleted', JSON.stringify(del.body))).toBe(JSON.stringify(del.body));
    expect(await deliveryPayloadFor(s.ws, s.w.friend.id, 'contact.deleted', JSON.stringify(del.body))).toBeNull();
    expect(JSON.stringify(mine)).not.toContain('secret');
    expect(JSON.stringify(mine)).not.toContain('Owner Only Co');
    expect(JSON.stringify(mine)).not.toContain('Hidden');
    const all = await deliveries(h.owner);
    expect(all.filter((d) => d.event === 'contact.deleted')).toHaveLength(2);
    expect(JSON.stringify(all)).toContain('co-secret');
    expect(JSON.stringify(await deliveries(h.admin))).toContain('d-secret');
    expect(await deliveries(h.stranger)).toEqual([]);
  });

  it('al reenviar se arma con el acceso de hoy: un admin que pasó a miembro ya no recibe lo oculto, y quien salió no recibe nada', async () => {
    const s = await setup('p3-wh-retry');
    const h = await hook(s.ws, s.adminPerson.id, ['contact.updated']);
    await updateContact(s.ws, s.memberContact.id, { jobTitle: 'Before' });
    const [first] = await deliveries(h);
    expect(dataOf(first).custom).toMatchObject({ secret: 's-1' });

    // Pasa a miembro con "mine": el contacto no es suyo.
    await setMemberRole(s.w.team.id, s.adminPerson.id, 'member');
    expect(await deliveryPayloadFor(s.ws, s.adminPerson.id, 'contact.updated', JSON.stringify(first.body))).toBeNull();
    const again = await resendDelivery(s.ws, first.id);
    expect(typeof again).toBe('string');
    const resent = (await deliveries(h)).find((d) => d.id === again)!;
    expect(resent.status).toBe('failed');
    expect(resent.error).toBe('audience_revoked');

    // Con "todo visible" recibe el registro, pero sin el campo que tiene oculto.
    await setMemberVisibility(s.ws, 'all');
    const third = await resendDelivery(s.ws, first.id);
    const row = (await deliveries(h)).find((d) => d.id === third)!;
    expect(dataOf(row).custom).toEqual({ tier: 'gold' });

    // Sale del workspace: nada.
    await removeMember(s.w.team.id, s.adminPerson.id);
    expect(await deliveryPayloadFor(s.ws, s.adminPerson.id, 'contact.updated', JSON.stringify(first.body))).toBeNull();
    // Lo que no es del CRM pasa tal cual.
    expect(await deliveryPayloadFor(s.ws, s.adminPerson.id, 'ping', '{"x":1}')).toBe('{"x":1}');
  });

  it('el personalizador (lo usan también los flows) da lo mismo para cada mirada', async () => {
    const s = await setup('p3-personalize');
    const data = { id: s.memberContact.id, custom: { secret: 's-1', tier: 'gold' }, change: { changed: ['custom.secret', 'custom.tier', 'email'] } };
    const p = crmPersonalizer(s.ws, 'contact.updated', data);
    expect((await p(s.ws))?.data).toBe(data);
    expect((await p(s.adminPerson.id))?.data).toBe(data);
    expect((await p(s.w.member.id))?.data).toMatchObject({ custom: { tier: 'gold' }, change: { changed: ['custom.tier', 'email'] } });
    expect(await p(s.w.friend.id)).toBeNull();
    expect(await p(s.w.stranger.id)).toBeNull();
    expect(await p(null)).toBeNull();
    // Un id de otro workspace no cuenta como registro visible.
    const other = await createContact(s.w.stranger.id, { firstName: 'Other', ownerId: s.w.stranger.id });
    expect(await crmPersonalizer(s.ws, 'contact.updated', { id: other.id, custom: {} })(s.w.member.id)).toBeNull();
  });
});

// ---------- 2. form.submitted ----------

describe('form.submitted', () => {
  const FIELDS: FormField[] = [
    { id: 'email', type: 'email', label: 'Email', property: 'email', required: true },
    { id: 'budget', type: 'text', label: 'Budget', property: 'custom.secret', required: false },
    { id: 'tierq', type: 'text', label: 'Tier question', property: 'custom.tier', required: false },
    { id: 'note', type: 'text', label: 'Note', property: '', required: false },
  ];

  it('cada webhook recibe los valores que su creador ve; fuera de su alcance, nada', async () => {
    const s = await setup('p3-form-hook');
    const h = await hooksFor(s, ['form.submitted']);
    const form = await createForm(s.ws, { name: 'Signup', fields: FIELDS, settings: { minSubmitSeconds: 0, ownerId: s.w.member.id } });
    await submitForm(form.token, { values: { email: 'form-lead@example.test', budget: 'b-900', tierq: 't-gold', note: 'hello' }, elapsedMs: 9000 });

    const values = async (id: string) => (await deliveries(id)).map((d) => (dataOf(d).submission as { values: Record<string, unknown> }).values);
    expect((await values(h.owner))[0]).toMatchObject({ budget: 'b-900', tierq: 't-gold' });
    expect((await values(h.admin))[0]).toMatchObject({ budget: 'b-900' });
    expect((await values(h.member))[0]).toEqual({ email: 'form-lead@example.test', tierq: 't-gold', note: 'hello' });
    // El contacto es de member: fuera del alcance de friend con "mine".
    expect(await deliveries(h.team)).toEqual([]);
    expect(await deliveries(h.stranger)).toEqual([]);
  });

  it('un miembro de un equipo de ventas no recibe lo que va a un campo oculto para su equipo', async () => {
    const s = await setup('p3-form-team');
    await setMemberVisibility(s.ws, 'all');
    const form = await createForm(s.ws, { name: 'Signup', fields: FIELDS, settings: { minSubmitSeconds: 0 } });
    const data = { form: { id: form.id }, submission: { id: 'x', values: { email: 'a@example.test', budget: 'b-1', tierq: 't-1' } }, contact: null };
    const p = crmPersonalizer(s.ws, 'form.submitted', data, { formFields: form.fields });
    expect(((await p(s.w.friend.id))?.data.submission as { values: unknown }).values).toEqual({ email: 'a@example.test' });
    expect(((await p(s.w.member.id))?.data.submission as { values: unknown }).values).toEqual({ email: 'a@example.test', tierq: 't-1' });
    expect((await p(s.ws))?.data).toBe(data);
    // Sin la definición del form no se sabe a dónde iba cada valor: no sale ninguno.
    const blind = crmPersonalizer(s.ws, 'form.submitted', data, { formFields: null });
    expect(((await blind(s.w.member.id))?.data.submission as { values: unknown }).values).toEqual({});
    expect(await p(s.w.stranger.id)).toBeNull();
  });

  // ---------- 4. Columnas de la tabla y el CSV de envíos ----------

  it('la tabla y el CSV no llevan la columna (ni la etiqueta) de un campo oculto para quien mira', async () => {
    const s = await setup('p3-form-cols');
    await setMemberVisibility(s.ws, 'all');
    const form = await createForm(s.ws, { name: 'Signup', fields: FIELDS, settings: { minSubmitSeconds: 0 } });
    await submitForm(form.token, { values: { email: 'cols@example.test', budget: 'b-1', tierq: 't-1', note: 'n' }, elapsedMs: 9000 });
    const header = async (u: SessionUser) => {
      session.user = u;
      const csv = await (await submissionsRoute.GET(get(`http://x/api/crm/forms/${form.id}/submissions?format=csv`), ctx(form.id))).text();
      return csv.split('\n')[0];
    };
    for (const u of [owner(s), admin(s)]) {
      const h = await header(u);
      expect(h).toContain('Budget');
      expect(h).toContain('Tier question');
    }
    const m = await header(member(s));
    expect(m).not.toContain('Budget');
    expect(m).toContain('Tier question');
    const t = await header(teamMember(s));
    expect(t).not.toContain('Budget');
    expect(t).not.toContain('Tier question');
    expect(t).toContain('Note');
    session.user = stranger(s);
    expect((await submissionsRoute.GET(get('http://x'), ctx(form.id))).status).toBe(404);

    const ids = async (v: ReturnType<typeof viewerOf>) => (await submissionFieldsFor(v, form)).map((f) => f.id);
    expect(await ids(viewerOf(s, s.ws, 'owner'))).toEqual(['email', 'budget', 'tierq', 'note']);
    expect(await ids(viewerOf(s, s.adminPerson.id, 'admin'))).toEqual(['email', 'budget', 'tierq', 'note']);
    expect(await ids(viewerOf(s, s.w.member.id, 'member'))).toEqual(['email', 'tierq', 'note']);
    expect(await ids(viewerOf(s, s.w.friend.id, 'member'))).toEqual(['email', 'note']);
  });
});

// ---------- 3. Ids huérfanos ----------

describe('ids huérfanos', () => {
  it('un id borrado o de otro workspace queda vacío para todos, sin "Registro privado"', async () => {
    const s = await setup('p3-orphan');
    const gone = await createCompany(s.ws, { name: 'Gone Co', ownerId: s.w.member.id });
    await getDb().prepare('DELETE FROM crm_companies WHERE id = ?').run(gone.id);
    const foreign = await createCompany(s.w.stranger.id, { name: 'Foreign Co', ownerId: s.w.stranger.id });
    const rows = [
      { id: 'a', company_id: s.ownerCo.id, company_name: 'Hidden Owner Co' },
      { id: 'b', company_id: gone.id, company_name: null },
      { id: 'c', company_id: foreign.id, company_name: 'Foreign Co' },
      { id: 'd', company_id: null, company_name: null },
    ];
    const spec = [PRIVATE_REFS.company(['company_name'])];
    const orphanB = { id: 'b', company_id: null, company_name: null };
    const orphanC = { id: 'c', company_id: null, company_name: null };
    // Owner y admin (sin alcance): el registro que existe se ve; los huérfanos, vacíos.
    for (const scope of [null, undefined]) {
      const out = await maskPrivateRefs(s.ws, rows, spec, scope);
      expect(out).toEqual([rows[0], orphanB, orphanC, rows[3]]);
    }
    // Miembro con "mine" y miembro de equipo: el del owner es privado; los huérfanos, igual que para el admin.
    for (const scope of [[s.w.member.id], [s.w.friend.id]]) {
      const out = await maskPrivateRefs(s.ws, rows, spec, scope);
      expect(out[0]).toEqual({ id: 'a', company_id: null, company_name: null, company_private: true });
      expect(out.slice(1)).toEqual([orphanB, orphanC, rows[3]]);
    }
    // Desde otro workspace, un id de este es un huérfano más.
    const other = await maskPrivateRefs(s.w.stranger.id, [rows[0]], spec, null);
    expect(other[0]).toEqual({ id: 'a', company_id: null, company_name: null });
    // Sin nada que limpiar devuelve las mismas filas.
    expect(await maskPrivateRefs(s.ws, [rows[0], rows[3]], spec, null)).toEqual([rows[0], rows[3]]);
  });

  it('la lista de contactos: la empresa borrada no sale como privada para nadie', async () => {
    const s = await setup('p3-orphan-list');
    const gone = await createCompany(s.ws, { name: 'Gone Co', ownerId: s.w.member.id });
    const c = await createContact(s.ws, { firstName: 'Orphan', ownerId: s.w.member.id, companyId: gone.id });
    await getDb().prepare('PRAGMA foreign_keys = OFF').run();
    try {
      await getDb().prepare('DELETE FROM crm_companies WHERE id = ?').run(gone.id);
    } finally {
      await getDb().prepare('PRAGMA foreign_keys = ON').run();
    }
    for (const scope of [null, [s.w.member.id]]) {
      const { rows } = await listContacts(s.ws, { q: 'Orphan', ownerScope: scope });
      const row = rows.find((r) => r.id === c.id)!;
      expect(row.company_id).toBeNull();
      expect(row.company_private).toBeUndefined();
    }
  });
});

// ---------- 6. Workflows ----------

describe('workflows que nombran un campo oculto', () => {
  it('workflowUsesHiddenField busca custom.<x> en disparadores, filtros, acciones y plantillas', () => {
    const base = { triggers: [{ config: {} }], actions: [{ config: { message: 'Hi' } }], settings: { reenroll: false, filters: [] } };
    expect(workflowUsesHiddenField(base, new Set(['secret']))).toBe(false);
    expect(workflowUsesHiddenField({ ...base, triggers: [{ config: { field: 'custom.secret' } }] }, new Set(['secret']))).toBe(true);
    expect(workflowUsesHiddenField({ ...base, actions: [{ config: { message: 'V: {{deal.custom.secret}}' } }] }, new Set(['secret']))).toBe(true);
    expect(
      workflowUsesHiddenField({ ...base, settings: { reenroll: false, filters: [{ entity: 'contact', field: 'custom.secret', op: 'is_set' }] } }, new Set(['secret'])),
    ).toBe(true);
    expect(workflowUsesHiddenField({ ...base, actions: [{ config: { field: 'custom.secretive' } }] }, new Set(['secret']))).toBe(false);
    expect(workflowUsesHiddenField({ ...base, actions: [{ config: { field: 'custom.secret' } }] }, new Set())).toBe(false);
  });

  it('no sale en la lista, la ficha del workflow ni la tarjeta del registro de quien tiene el campo oculto', async () => {
    const s = await setup('p3-workflows');
    await setMemberVisibility(s.ws, 'all');
    const bySecret = await createWorkflow(s.ws, {
      name: 'Secret flow',
      triggers: [{ type: 'contact_updated', config: { field: 'custom.secret' } }],
      actions: [{ type: 'notify_user', config: { message: 'changed' } }],
    });
    const byTier = await createWorkflow(s.ws, {
      name: 'Tier flow',
      triggers: [{ type: 'contact_created', config: {} }],
      actions: [{ type: 'notify_user', config: { message: 'Tier {{contact.custom.tier}}' } }],
    });
    const plain = await createWorkflow(s.ws, {
      name: 'Plain flow',
      triggers: [{ type: 'contact_created', config: {} }],
      actions: [{ type: 'notify_user', config: { message: 'new' } }],
    });
    const names = async (u: SessionUser) => {
      session.user = u;
      return (await json<{ workflows: Array<{ name: string }> }>(await workflowsRoute.GET())).workflows.map((w) => w.name).sort();
    };
    expect(await names(owner(s))).toEqual(['Plain flow', 'Secret flow', 'Tier flow']);
    expect(await names(admin(s))).toEqual(['Plain flow', 'Secret flow', 'Tier flow']);
    expect(await names(member(s))).toEqual(['Plain flow', 'Tier flow']);
    expect(await names(teamMember(s))).toEqual(['Plain flow']);
    expect(await names(stranger(s))).toEqual([]);

    const status = async (u: SessionUser, id: string) => {
      session.user = u;
      return (await workflowRoute.GET(get('http://x'), ctx(id))).status;
    };
    expect(await status(owner(s), bySecret.id)).toBe(200);
    expect(await status(admin(s), bySecret.id)).toBe(200);
    expect(await status(member(s), bySecret.id)).toBe(404);
    expect(await status(member(s), byTier.id)).toBe(200);
    expect(await status(teamMember(s), byTier.id)).toBe(404);
    expect(await status(stranger(s), plain.id)).toBe(404);

    // Tarjeta "Workflows" de la ficha: inscripciones del registro.
    for (const wf of [bySecret, byTier, plain]) {
      await getDb()
        .prepare(
          `INSERT INTO crm_workflow_runs (id, workflow_id, user_id, trigger_entity, trigger_entity_id, trigger_type, status, output, started_at)
           VALUES (?, ?, ?, 'contact', ?, 'contact_created', 'done', '{}', datetime('now'))`,
        )
        .run(crypto.randomUUID(), wf.id, s.ws, s.memberContact.id);
    }
    const card = async (v?: ReturnType<typeof viewerOf>) =>
      (await listRecordEnrollments(s.ws, 'contact', s.memberContact.id, 20, v)).map((e) => e.workflow_name).sort();
    expect(await card(viewerOf(s, s.ws, 'owner'))).toEqual(['Plain flow', 'Secret flow', 'Tier flow']);
    expect(await card(viewerOf(s, s.adminPerson.id, 'admin'))).toEqual(['Plain flow', 'Secret flow', 'Tier flow']);
    expect(await card(viewerOf(s, s.w.member.id, 'member'))).toEqual(['Plain flow', 'Tier flow']);
    expect(await card(viewerOf(s, s.w.friend.id, 'member'))).toEqual(['Plain flow']);
    expect(await listRecordEnrollments(s.w.stranger.id, 'contact', s.memberContact.id)).toEqual([]);
    expect((await workflowsForViewer(viewerOf(s, s.w.member.id, 'member'), [bySecret])).length).toBe(0);
  });
});
