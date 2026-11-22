/**
 * CRM, listados de contactos y empresas (bloque P2): los filtros rápidos
 * (owner "sin responsable", fecha de última actividad) y las acciones masivas
 * de la barra (asignar, editar propiedad, agregar a lista, exportar la
 * selección, eliminar) respetan sesión, workspace, alcance de registros y
 * permisos por campo en el server. Miradas: anónimo, otro workspace, miembro
 * que no ve el registro y owner. Los datos son inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, createList, getContact, listCompanies, listContacts } from '@/lib/crm';
import { getDb } from '@/lib/db';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { OWNER_UNASSIGNED } from '@/lib/crm-filter-model';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const exportRoute = await import('@/app/api/crm/export/route');
const contactsBulk = await import('@/app/api/crm/contacts/bulk/route');
const companiesBulk = await import('@/app/api/crm/companies/bulk/route');
const listMembersRoute = await import('@/lib/routes/crm/lists/[id]/members/route');

beforeEach(() => {
  session.user = null;
});

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const exportIds = (entity: string, ids: string[]) =>
  exportRoute.GET(new NextRequest(`http://test.local/api/crm/export?entity=${entity}&format=json&ids=${ids.join(',')}`));

describe('export of the selected rows (ids)', () => {
  it('anonymous 401, teammate 403, other workspace gets none of our rows, owner gets only the picked ones', async () => {
    const w = await workspaceWithMember('p2-exp');
    const a = await createContact(w.owner.id, { firstName: 'Exp A', email: 'exp-a@example.test' });
    const b = await createContact(w.owner.id, { firstName: 'Exp B', email: 'exp-b@example.test' });
    await createContact(w.owner.id, { firstName: 'Exp C', email: 'exp-c@example.test' });
    const expected = { anonymous: 401, other_workspace: 200, teammate: 403, owner: 200 } as const;
    for (const r of roles(w)) {
      session.user = r.user;
      const res = await exportIds('contacts', [a.id, b.id]);
      expect(res.status, r.name).toBe(expected[r.name]);
      if (res.status !== 200) continue;
      const rows = (await res.json()) as Array<{ id: string }>;
      if (r.name === 'other_workspace') expect(rows).toEqual([]);
      else expect(rows.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    }
  });

  it('rejects an empty or oversized id list', async () => {
    const w = await workspaceWithMember('p2-exp2');
    session.user = asOwner(w.owner);
    expect((await exportIds('companies', [])).status).toBe(400);
    expect((await exportIds('companies', Array.from({ length: 501 }, (_, i) => `id${i}`))).status).toBe(400);
  });
});

describe('bulk assign and edit', () => {
  it('assign owner: anonymous 401, other workspace and a member who cannot see the record change nothing, owner assigns', async () => {
    const w = await workspaceWithMember('p2-assign');
    await setMemberVisibility(w.owner.id, 'mine');
    const c = await createContact(w.owner.id, { firstName: 'Assign Me', ownerId: w.owner.id });
    const body = { action: 'set_property', ids: [c.id], field: 'ownerId', value: w.friend.id };

    session.user = null;
    expect((await contactsBulk.POST(post('http://test.local/api/crm/contacts/bulk', body))).status).toBe(401);

    session.user = asOwner(w.stranger);
    const other = await contactsBulk.POST(post('http://test.local/api/crm/contacts/bulk', body));
    expect(((await other.json()) as { count: number }).count).toBe(0);

    session.user = asMember(w.owner, w.member);
    const hidden = await contactsBulk.POST(post('http://test.local/api/crm/contacts/bulk', body));
    expect(((await hidden.json()) as { count: number }).count).toBe(0);
    expect((await getContact(w.owner.id, c.id))?.contact.owner_id).toBe(w.owner.id);

    session.user = asOwner(w.owner);
    const ok = await contactsBulk.POST(post('http://test.local/api/crm/contacts/bulk', body));
    expect(((await ok.json()) as { count: number }).count).toBe(1);
    expect((await getContact(w.owner.id, c.id))?.contact.owner_id).toBe(w.friend.id);

    // "Sin responsable" desde la barra manda null.
    await contactsBulk.POST(post('http://test.local/api/crm/contacts/bulk', { ...body, value: null }));
    expect((await getContact(w.owner.id, c.id))?.contact.owner_id ?? null).toBeNull();
  });

  it('edit property: a member cannot bulk edit a field hidden from them; delete is admin only', async () => {
    const w = await workspaceWithMember('p2-edit');
    const f = await createCustomField(w.owner.id, { entity: 'companies', name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(w.owner.id, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    const co = await createCompany(w.owner.id, { name: 'Edit Co', ownerId: w.member.id });

    session.user = asMember(w.owner, w.member);
    const res = await companiesBulk.POST(
      post('http://test.local/api/crm/companies/bulk', { action: 'set_property', ids: [co.id], field: 'custom:secret', value: 'x' }),
    );
    expect(res.status).toBe(403);
    const del = await companiesBulk.POST(post('http://test.local/api/crm/companies/bulk', { action: 'delete', ids: [co.id] }));
    expect(del.status).toBe(403);

    session.user = asOwner(w.owner);
    const ok = await companiesBulk.POST(
      post('http://test.local/api/crm/companies/bulk', { action: 'set_property', ids: [co.id], field: 'custom:secret', value: 'x' }),
    );
    expect(ok.status).toBe(200);
  });
});

describe('bulk add to list', () => {
  it('only adds contacts the person can see, and only to a list of their workspace', async () => {
    const w = await workspaceWithMember('p2-list');
    await setMemberVisibility(w.owner.id, 'mine');
    const list = await createList(w.owner.id, { name: 'P2 list', entity: 'contacts', kind: 'static' });
    const mine = await createContact(w.owner.id, { firstName: 'Mine', ownerId: w.member.id });
    const notMine = await createContact(w.owner.id, { firstName: 'Not mine', ownerId: w.owner.id });
    const ctx = { params: Promise.resolve({ id: list.id }) };
    const add = () => listMembersRoute.POST(post(`http://test.local/api/crm/lists/${list.id}/members`, { contactIds: [mine.id, notMine.id] }), ctx);

    session.user = null;
    expect((await add()).status).toBe(401);
    session.user = asOwner(w.stranger);
    expect((await add()).status).toBe(404);
    session.user = asMember(w.owner, w.member);
    expect(((await (await add()).json()) as { count: number }).count).toBe(1);
    const members = (await getDb().prepare('SELECT contact_id FROM crm_list_members WHERE list_id = ?').all(list.id)) as Array<{ contact_id: string }>;
    expect(members.map((m) => m.contact_id)).toEqual([mine.id]);
    session.user = asOwner(w.owner);
    expect(((await (await add()).json()) as { count: number }).count).toBe(1);
  });
});

describe('quick filters in the list queries', () => {
  it('owner "unassigned" and last activity range / none', async () => {
    const w = await workspaceWithMember('p2-qf');
    const ws = w.owner.id;
    const none = await createContact(ws, { firstName: 'Nobody', ownerId: null });
    const owned = await createContact(ws, { firstName: 'Owned', ownerId: ws });
    await getDb().prepare('UPDATE crm_contacts SET owner_id = NULL WHERE id = ?').run(none.id);
    await getDb().prepare("UPDATE crm_contacts SET last_activity_at = '2026-03-10 12:00:00' WHERE id = ?").run(owned.id);

    const unassigned = await listContacts(ws, { owner: OWNER_UNASSIGNED });
    expect(unassigned.rows.map((r) => r.id)).toContain(none.id);
    expect(unassigned.rows.map((r) => r.id)).not.toContain(owned.id);

    const inRange = await listContacts(ws, { activityFrom: '2026-03-01', activityTo: '2026-03-31' });
    expect(inRange.rows.map((r) => r.id)).toEqual([owned.id]);
    const outRange = await listContacts(ws, { activityFrom: '2026-04-01' });
    expect(outRange.rows.map((r) => r.id)).not.toContain(owned.id);
    const noActivity = await listContacts(ws, { activityNone: true });
    expect(noActivity.rows.map((r) => r.id)).toContain(none.id);
    expect(noActivity.rows.map((r) => r.id)).not.toContain(owned.id);

    const co = await createCompany(ws, { name: 'Active Co' });
    await getDb().prepare("UPDATE crm_companies SET last_activity_at = '2026-03-10 12:00:00' WHERE id = ?").run(co.id);
    expect((await listCompanies(ws, { activityFrom: '2026-03-10', activityTo: '2026-03-10' })).rows.map((r) => r.id)).toEqual([co.id]);
    expect((await listCompanies(ws, { activityNone: true })).rows.map((r) => r.id)).not.toContain(co.id);
  });
});
