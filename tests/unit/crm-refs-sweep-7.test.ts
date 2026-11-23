/**
 * CRM, séptima pasada: vincular en masa una empresa que no se ve, filtrar
 * listas por un registro que no se ve, la respuesta de fusionar y el
 * historial no nombran (ni dan el id de) empresas que la persona no ve; y un
 * form no puede guardar en una propiedad que quien lo arma no puede editar.
 * Miradas: anónimo, otro workspace, miembro con "mine" y el campo `secret`
 * oculto, admin y owner. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { createLead } from '@/lib/crm-leads';
import { addMember } from '@/lib/teams';
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

const bulkRoute = await import('@/app/api/crm/contacts/bulk/route');
const contactsRoute = await import('@/app/api/crm/contacts/route');
const leadsRoute = await import('@/app/api/crm/leads/route');
const mergeRoute = await import('@/app/api/crm/contacts/merge/route');
const historyRoute = await import('@/app/api/crm/history/route');
const formsRoute = await import('@/app/api/crm/forms/route');
const formRoute = await import('@/lib/routes/crm/forms/[id]/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const send = (method: string, url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  const f = await createCustomField(ws, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
  await setFieldPermissions(ws, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  const hiddenCo = await createCompany(ws, { name: 'Hidden Holdings', domain: `hidden-${label}.test`, ownerId: ws });
  const mineCo = await createCompany(ws, { name: 'Mine Co', domain: `mine-${label}.test`, ownerId: w.member.id });
  const mineContact = await createContact(ws, { firstName: 'Mine', email: `mine-${label}@client.test`, ownerId: w.member.id });
  return { w, ws, adminPerson, hiddenCo, mineCo, mineContact };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);

describe('CRM séptima pasada: referencias a registros que no se ven', () => {
  it('anónimo 401 en las rutas', async () => {
    expect((await bulkRoute.POST(send('POST', '/api/crm/contacts/bulk', { action: 'count', ids: ['x'] }))).status).toBe(401);
    expect((await contactsRoute.GET(send('GET', '/api/crm/contacts?companyId=x'))).status).toBe(401);
    expect((await formsRoute.POST(send('POST', '/api/crm/forms', { name: 'F' }))).status).toBe(401);
  });

  it('vincular en masa una empresa que no ve: el mismo error que una que no existe; owner y admin, sí', async () => {
    const s = await setup('s7bulk');
    const setCompany = (user: SessionUser, companyId: string) => {
      session.user = user;
      return bulkRoute.POST(send('POST', '/api/crm/contacts/bulk', { action: 'set_property', ids: [s.mineContact.id], field: 'companyId', value: companyId }));
    };
    const hidden = await setCompany(member(s), s.hiddenCo.id);
    const missing = await setCompany(member(s), 'no-such-company');
    expect(hidden.status).toBe(400);
    expect(await hidden.json()).toEqual(await missing.json());
    expect((await setCompany(member(s), s.mineCo.id)).status).toBe(200);
    expect((await setCompany(admin(s), s.hiddenCo.id)).status).toBe(200);
    expect((await setCompany(owner(s), s.hiddenCo.id)).status).toBe(200);
    // Otro workspace no toca este contacto.
    session.user = asOwner(s.w.stranger);
    const other = await bulkRoute.POST(send('POST', '/api/crm/contacts/bulk', { action: 'set_property', ids: [s.mineContact.id], field: 'companyId', value: null }));
    expect(((await other.json()) as { count?: number }).count ?? 0).toBe(0);
  });

  it('filtrar contactos o leads por una empresa que no ve no lista nada', async () => {
    const s = await setup('s7filter');
    await getDb().prepare('INSERT INTO crm_contact_companies (contact_id, company_id, user_id) VALUES (?, ?, ?)').run(s.mineContact.id, s.hiddenCo.id, s.ws).catch(() => null);
    await getDb().prepare('UPDATE crm_contacts SET company_id = ? WHERE id = ?').run(s.hiddenCo.id, s.mineContact.id);
    await createLead(s.ws, { name: 'Lead', companyId: s.hiddenCo.id, ownerId: s.w.member.id });
    session.user = member(s);
    const contacts = (await (await contactsRoute.GET(send('GET', `/api/crm/contacts?companyId=${s.hiddenCo.id}`))).json()) as { rows: unknown[]; total: number };
    expect(contacts).toMatchObject({ rows: [], total: 0 });
    const leads = (await (await leadsRoute.GET(send('GET', `/api/crm/leads?companyId=${s.hiddenCo.id}`))).json()) as { rows: unknown[]; total: number };
    expect(leads).toMatchObject({ rows: [], total: 0 });
    session.user = owner(s);
    const own = (await (await contactsRoute.GET(send('GET', `/api/crm/contacts?companyId=${s.hiddenCo.id}`))).json()) as { total: number };
    expect(own.total).toBeGreaterThan(0);
  });

  it('fusionar: la empresa que queda y no ve sale privada; el historial no da el id de una madre que no ve', async () => {
    const s = await setup('s7merge');
    const keep = await createContact(s.ws, { firstName: 'Keep', email: `keep-s7merge@client.test`, ownerId: s.w.member.id });
    const drop = await createContact(s.ws, { firstName: 'Drop', email: `drop-s7merge@client.test`, ownerId: s.w.member.id, companyId: s.hiddenCo.id });
    session.user = member(s);
    const merged = await mergeRoute.POST(send('POST', '/api/crm/contacts/merge', { keepId: keep.id, dropId: drop.id }));
    expect(merged.status).toBe(200);
    expect(JSON.stringify(await merged.json())).not.toContain(s.hiddenCo.id);
    // La empresa del miembro pasó a tener como madre una que no ve (registro del historial).
    await getDb()
      .prepare("INSERT INTO crm_property_events (id, user_id, entity, entity_id, field, old_value, new_value, actor_email) VALUES (?, ?, 'company', ?, 'parent_company_id', '', ?, 'x@test.local')")
      .run(crypto.randomUUID(), s.ws, s.mineCo.id, s.hiddenCo.id);
    const history = await historyRoute.GET(send('GET', `/api/crm/history?entity=company&entityId=${s.mineCo.id}`));
    expect(history.status).toBe(200);
    expect(JSON.stringify(await history.json())).not.toContain(s.hiddenCo.id);
    session.user = owner(s);
    expect(JSON.stringify(await (await historyRoute.GET(send('GET', `/api/crm/history?entity=company&entityId=${s.mineCo.id}`))).json())).toContain(s.hiddenCo.id);
  });

  it('un form no guarda en una propiedad que quien lo arma no puede editar; el admin sí', async () => {
    const s = await setup('s7form');
    const field = (property: string) => ({ id: property.replace(/\W/g, '_'), type: 'text', label: 'X', property, required: false });
    const fields = [{ id: 'email', type: 'email', label: 'Email', property: 'email', required: true }, field('custom.secret')];
    session.user = member(s);
    expect((await formsRoute.POST(send('POST', '/api/crm/forms', { name: 'Leak', fields }))).status).toBe(403);
    const plain = await formsRoute.POST(send('POST', '/api/crm/forms', { name: 'Plain', fields: [fields[0]] }));
    expect(plain.status).toBe(201);
    const plainId = ((await plain.json()) as { id: string }).id;
    expect((await formRoute.PATCH(send('PATCH', `/api/crm/forms/${plainId}`, { fields }), ctx(plainId))).status).toBe(403);
    session.user = admin(s);
    const byAdmin = await formsRoute.POST(send('POST', '/api/crm/forms', { name: 'Admin form', fields }));
    expect(byAdmin.status).toBe(201);
  });
});
