import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

import { getDb, upsertUser } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { canChangeNote, canSeeNotes, type PeopleViewer } from '@/lib/people-access';
import { deleteEmployee, createEmployee, getEmployee, listEmployees, peopleContext, updateEmployee, type PeopleCtx } from '@/lib/people';
import { addNote, deleteNote, listNotes, updateNote } from '@/lib/people-notes';
import * as notesRoute from '@/lib/routes/people/employees/[id]/notes/route';
import * as noteRoute from '@/lib/routes/people/notes/[id]/route';

const uid = () => Math.random().toString(36).slice(2, 10);

const viewer = (v: Partial<PeopleViewer>): PeopleViewer => ({ personId: 'u_me', employeeId: 'e_me', hr: false, reports: new Set(), ...v });

describe('notas sobre una persona: quién las ve', () => {
  it('HR y la cadena de managers sí; la persona y sus pares no', () => {
    expect(canSeeNotes(viewer({ hr: true }), 'e_x')).toBe(true);
    expect(canSeeNotes(viewer({ reports: new Set(['e_x']) }), 'e_x')).toBe(true);
    expect(canSeeNotes(viewer({}), 'e_x')).toBe(false);
    // Ni siquiera HR ve las notas sobre sí mismo.
    expect(canSeeNotes(viewer({ hr: true, employeeId: 'e_x' }), 'e_x')).toBe(false);
  });

  it('edita solo su autor; borra su autor o HR', () => {
    const mine = { employeeId: 'e_x', authorId: 'u_me' };
    const other = { employeeId: 'e_x', authorId: 'u_other' };
    const mgr = viewer({ reports: new Set(['e_x']) });
    const hr = viewer({ hr: true });
    expect(canChangeNote(mgr, mine, 'edit')).toBe(true);
    expect(canChangeNote(mgr, mine, 'delete')).toBe(true);
    expect(canChangeNote(mgr, other, 'edit')).toBe(false);
    expect(canChangeNote(mgr, other, 'delete')).toBe(false);
    expect(canChangeNote(hr, other, 'edit')).toBe(false);
    expect(canChangeNote(hr, other, 'delete')).toBe(true);
    // Quien dejó de ser su manager ya no toca ni lo propio.
    expect(canChangeNote(viewer({}), mine, 'edit')).toBe(false);
  });
});

describe('notas sobre una persona, con la base', () => {
  let owner: string;
  let hr: PeopleCtx;
  let users: Record<string, string>;
  let ids: Record<string, string>;
  const as = (u: string) => peopleContext(owner, u, 'member');

  beforeAll(async () => {
    const o = await upsertUser({ email: `notes-owner-${uid()}@example.com`, name: 'Olga Owner', image: null });
    owner = o.id;
    const team = await ensureWorkspace(owner);
    users = {};
    for (const name of ['manager', 'carla', 'dani']) {
      const u = await upsertUser({ email: `notes-${name}-${uid()}@example.com`, name: name[0].toUpperCase() + name.slice(1), image: null });
      await addMember(team.id, u.id, 'member');
      users[name] = u.id;
    }
    hr = await peopleContext(owner, owner, 'owner');
    const all = await listEmployees(hr);
    const byUser = (u: string) => all.find((e) => e.userId === u)!.id;
    ids = { owner: byUser(owner), manager: byUser(users.manager), carla: byUser(users.carla), dani: byUser(users.dani) };
    await updateEmployee(hr, ids.manager, { managerId: ids.owner });
    await updateEmployee(hr, ids.carla, { managerId: ids.manager });
    await updateEmployee(hr, ids.dani, { managerId: ids.owner });
  });

  it('HR y el manager escriben y leen; la persona y un par reciben not_found', async () => {
    const byHr = await addNote(hr, ids.carla, { body: '  Talked about the move to the platform team.  ' });
    expect(byHr.body).toBe('Talked about the move to the platform team.');
    expect(byHr.authorName).toBe('Olga Owner');
    const mgr = await as(users.manager);
    const byMgr = await addNote(mgr, ids.carla, { body: 'Agreed on a 30-day plan.' });
    const list = await listNotes(mgr, ids.carla);
    expect(list.map((n) => n.id)).toEqual([byMgr.id, byHr.id]);
    expect(list.find((n) => n.id === byMgr.id)).toMatchObject({ canEdit: true, canDelete: true });
    expect(list.find((n) => n.id === byHr.id)).toMatchObject({ canEdit: false, canDelete: false });
    expect((await getEmployee(mgr, ids.carla, { audit: false }))?.can.seeNotes).toBe(true);

    const carla = await as(users.carla);
    await expect(listNotes(carla, ids.carla)).rejects.toMatchObject({ code: 'not_found' });
    await expect(addNote(carla, ids.carla, { body: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await getEmployee(carla, ids.carla, { audit: false }))?.can.seeNotes).toBe(false);
    const dani = await as(users.dani);
    await expect(listNotes(dani, ids.carla)).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateNote(dani, byMgr.id, { body: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteNote(dani, byMgr.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('edita su autor, HR borra la de otro, y valida el texto', async () => {
    const mgr = await as(users.manager);
    const n = await addNote(mgr, ids.carla, { body: 'First version' });
    const edited = await updateNote(mgr, n.id, { body: 'Second version' });
    expect(edited.body).toBe('Second version');
    await expect(updateNote(hr, n.id, { body: 'HR rewrite' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(addNote(mgr, ids.carla, { body: '   ' })).rejects.toMatchObject({ code: 'note_required' });
    await expect(addNote(mgr, ids.carla, { body: 'x'.repeat(5001) })).rejects.toMatchObject({ code: 'note_too_long' });
    await deleteNote(hr, n.id);
    expect((await listNotes(hr, ids.carla)).some((x) => x.id === n.id)).toBe(false);
  });

  it('otro workspace no ve ni toca las notas', async () => {
    const other = await upsertUser({ email: `notes-stranger-${uid()}@example.com`, name: 'Sam', image: null });
    await ensureWorkspace(other.id);
    const stranger = await peopleContext(other.id, other.id, 'owner');
    const n = await addNote(hr, ids.dani, { body: 'Private to this workspace' });
    await expect(listNotes(stranger, ids.dani)).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateNote(stranger, n.id, { body: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteNote(stranger, n.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('las rutas: anónimo 401, la persona 404, HR 201 y 200', async () => {
    const params = { params: Promise.resolve({ id: ids.dani }) };
    const req = (method: string, body?: unknown) => new Request('http://x/api', { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } });
    const ownerRow = { id: owner, email: 'o@example.com', name: 'Olga Owner' };
    session.user = null;
    expect((await notesRoute.GET(req('GET') as never, params)).status).toBe(401);
    const daniRow = await getDb().prepare('SELECT * FROM users WHERE id = ?').get(users.dani);
    session.user = { ...ownerRow, actingUser: daniRow, role: 'member', apps: '*' } as unknown as SessionUser;
    expect((await notesRoute.GET(req('GET') as never, params)).status).toBe(404);
    expect((await notesRoute.POST(req('POST', { body: 'self note' }) as never, params)).status).toBe(404);
    const ownerFull = await getDb().prepare('SELECT * FROM users WHERE id = ?').get(owner);
    session.user = { ...(ownerFull as object), role: 'owner', apps: '*' } as unknown as SessionUser;
    const created = await notesRoute.POST(req('POST', { body: 'From the route' }) as never, params);
    expect(created.status).toBe(201);
    const { note } = (await created.json()) as { note: { id: string } };
    const patched = await noteRoute.PATCH(req('PATCH', { body: 'Edited from the route' }) as never, { params: Promise.resolve({ id: note.id }) });
    expect(patched.status).toBe(200);
    expect((await noteRoute.DELETE(req('DELETE') as never, { params: Promise.resolve({ id: note.id }) })).status).toBe(200);
    session.user = null;
  });

  it('borrar la ficha borra sus notas', async () => {
    const temp = await createEmployee(hr, { name: 'Temp Person' });
    await addNote(hr, temp.id, { body: 'Short contract' });
    expect(await deleteEmployee(hr, temp.id)).toBe(true);
    const left = await getDb().prepare('SELECT COUNT(*) AS n FROM people_notes WHERE employee_id = ?').get(temp.id);
    expect(Number((left as { n: number }).n)).toBe(0);
  });
});
