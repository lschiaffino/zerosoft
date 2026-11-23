/**
 * CRM: una segunda definición con el nombre de un campo oculto no lo abre
 * (filtros, columnas, definiciones), y los filtros que cuentan asociados
 * (deals de un contacto, deal abierto, contactos de una empresa) cuentan
 * solo los que la persona ve. Miradas: anónimo, otro workspace, miembro con
 * "mine" y el campo oculto, admin y owner. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, createDeal, createPipeline, createStage } from '@/lib/crm';
import { MEMBER_SUBJECT, fieldAccessFor, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
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

const contactsRoute = await import('@/app/api/crm/contacts/route');
const companiesRoute = await import('@/app/api/crm/companies/route');
const fieldsRoute = await import('@/app/api/crm/custom-fields/route');

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
const filters = (f: string, o: string, v: string) => encodeURIComponent(JSON.stringify({ v: 1, groups: [{ rules: [{ f, o, v }] }] }));

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  const f = await createCustomField(ws, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
  await setFieldPermissions(ws, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  const contact = await createContact(ws, { firstName: 'Mine', email: `mine-${label}@client.test`, ownerId: w.member.id, custom: { secret: 'yes' } });
  return { w, ws, adminPerson, contact };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);

async function get(route: typeof contactsRoute, user: SessionUser | null, url: string): Promise<{ status: number; ids: string[] }> {
  session.user = user;
  const res = await route.GET(send('GET', url));
  if (res.status !== 200) return { status: res.status, ids: [] };
  return { status: 200, ids: ((await res.json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id) };
}

describe('CRM: campos con el mismo nombre y conteos de asociados', () => {
  it('anónimo 401', async () => {
    expect((await get(contactsRoute, null, '/api/crm/contacts')).status).toBe(401);
  });

  it('una copia con el nombre de un campo oculto no lo abre para el miembro', async () => {
    const s = await setup('fc7dup');
    session.user = member(s);
    const created = await fieldsRoute.POST(send('POST', '/api/crm/custom-fields', { entity: 'contacts', name: 'secret', label: 'Copy', type: 'text' }));
    expect(created.status).toBe(201);
    // Filtrar u ordenar por ese nombre sigue siendo un campo que no ve.
    expect((await get(contactsRoute, member(s), `/api/crm/contacts?filters=${filters('custom:secret', 'equals', 'yes')}`)).status).toBe(400);
    const access = await fieldAccessFor({ workspaceId: s.ws, personId: s.w.member.id, role: 'member' }, 'contacts');
    expect(access.visible.some((d) => d.name === 'secret')).toBe(false);
    expect(access.hidden.has('secret')).toBe(true);
    // Las definiciones que lista no incluyen ninguna de las dos.
    session.user = member(s);
    const defs = (await (await fieldsRoute.GET(send('GET', '/api/crm/custom-fields'))).json()) as { rows: Array<{ name: string }> };
    expect(defs.rows.some((d) => d.name === 'secret')).toBe(false);
    // Owner y admin filtran como siempre.
    for (const u of [owner(s), admin(s)]) {
      expect((await get(contactsRoute, u, `/api/crm/contacts?filters=${filters('custom:secret', 'equals', 'yes')}`)).ids).toEqual([s.contact.id]);
    }
  });

  it('deals y contactos asociados que no ve no cuentan en los filtros', async () => {
    const s = await setup('fc7count');
    const p = await createPipeline(s.ws, 'Sales');
    const stage = await createStage(s.ws, p.id, { name: 'Open' });
    const deal = await createDeal(s.ws, { name: 'Hidden deal', pipelineId: p.id, stageId: stage.id, ownerId: s.ws, contactIds: [s.contact.id] });
    expect(deal.ok).toBe(true);
    const company = await createCompany(s.ws, { name: 'Mine Co', domain: 'mine-fc7count.test', ownerId: s.w.member.id });
    const hiddenPerson = await createContact(s.ws, { firstName: 'Hidden', email: 'hidden-fc7count@client.test', ownerId: s.ws });
    await getDb().prepare('INSERT OR IGNORE INTO crm_contact_companies (contact_id, company_id, user_id) VALUES (?, ?, ?)').run(hiddenPerson.id, company.id, s.ws);
    const dealCount = `/api/crm/contacts?filters=${filters('dealCount', 'gt', '0')}`;
    const openDeal = `/api/crm/contacts?filters=${filters('hasOpenDeal', 'is', 'true')}`;
    const contactCount = `/api/crm/companies?filters=${filters('contactCount', 'gt', '0')}`;
    expect((await get(contactsRoute, member(s), dealCount)).ids).toEqual([]);
    expect((await get(contactsRoute, member(s), openDeal)).ids).toEqual([]);
    expect((await get(companiesRoute as unknown as typeof contactsRoute, member(s), contactCount)).ids).toEqual([]);
    expect((await get(contactsRoute, owner(s), dealCount)).ids).toContain(s.contact.id);
    expect((await get(contactsRoute, admin(s), openDeal)).ids).toContain(s.contact.id);
    expect((await get(companiesRoute as unknown as typeof contactsRoute, owner(s), contactCount)).ids).toContain(company.id);
    // Otro workspace no ve nada de esto.
    expect((await get(contactsRoute, asOwner(s.w.stranger), dealCount)).ids).not.toContain(s.contact.id);
  });
});
