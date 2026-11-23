/**
 * C3: CRM en vivo y anterior / siguiente. POST /api/crm/live con las miradas
 * de acceso (anónimo, otro workspace, member sin acceso al registro, member
 * con un campo oculto, admin, owner) y, sobre todo, que la firma nunca cambie
 * por algo que la persona no ve: un registro fuera de su alcance, un campo
 * oculto, una empresa que no ve. Más la lógica pura de la navegación. Datos
 * inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createActivity, createCompany, createContact, createCustomField, updateContact } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { navKey, neighbors, parseListNav } from '@/components/crm/recordNavModel';
import { NEVER_QUEUE } from '@/lib/offline-queue';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const route = await import('@/app/api/crm/live/route');

beforeEach(() => {
  session.user = null;
});

const post = (body: unknown) =>
  route.POST(new NextRequest('http://x/api/crm/live', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

async function sig(body: unknown): Promise<string> {
  const res = await post(body);
  expect(res.status).toBe(200);
  return ((await res.json()) as { sig: string }).sig;
}

/** Workspace con visibilidad "solo los suyos": el member ve lo suyo, no lo del compañero. */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  await setMemberVisibility(ws, 'mine');
  const secret = await createCustomField(ws, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
  await setFieldPermissions(ws, secret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  const mine = await createContact(ws, { firstName: 'Mine', ownerId: w.member.id, custom: { secret: 'a' } });
  const theirs = await createContact(ws, { firstName: 'Theirs', ownerId: w.friend.id });
  return { w, ws, mine, theirs };
}

describe('navegación: lógica pura', () => {
  it('neighbors: anterior, siguiente, posición; fuera de la lista no navega', () => {
    expect(neighbors(['a', 'b', 'c'], 'b')).toEqual({ prev: 'a', next: 'c', index: 1, total: 3 });
    expect(neighbors(['a', 'b', 'c'], 'a')).toEqual({ prev: null, next: 'b', index: 0, total: 3 });
    expect(neighbors(['a', 'b', 'c'], 'z')).toEqual({ prev: null, next: null, index: -1, total: 3 });
  });

  it('parseListNav: solo rutas del CRM de este sitio y ids de texto', () => {
    expect(parseListNav(JSON.stringify({ ids: ['a', 1, 'b'], href: '/app/crm/contacts?sort=name' }))).toEqual({ ids: ['a', 'b'], href: '/app/crm/contacts?sort=name' });
    expect(parseListNav(JSON.stringify({ ids: ['a'], href: 'https://evil.example/x' }))?.href).toBe('');
    expect(parseListNav(JSON.stringify({ ids: ['a'], href: '//evil.example' }))?.href).toBe('');
    expect(parseListNav('not json')).toBeNull();
    expect(parseListNav(JSON.stringify({ ids: 'a', href: '/app/crm/deals' }))).toBeNull();
  });

  it('navKey: j / k sin modificadores y nunca escribiendo', () => {
    const base = { metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: null };
    expect(navKey({ ...base, key: 'j' })).toBe('next');
    expect(navKey({ ...base, key: 'k' })).toBe('prev');
    expect(navKey({ ...base, key: 'j', metaKey: true })).toBeNull();
    expect(navKey({ ...base, key: 'x' })).toBeNull();
    expect(navKey({ ...base, key: 'j', target: { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget })).toBeNull();
    expect(navKey({ ...base, key: 'k', target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget })).toBeNull();
  });
});

describe('en vivo: acceso a /api/crm/live', () => {
  it('el sondeo nunca entra a la cola sin conexión', () => {
    expect(NEVER_QUEUE).toContain('/api/crm/live');
  });

  it('anónimo: 401; cuerpo inválido: 400', async () => {
    expect((await post({ list: 'contacts' })).status).toBe(401);
    session.user = asOwner((await workspaceWithMember('c3-anon')).owner);
    expect((await post({ list: 'nope' })).status).toBe(400);
    expect((await post({ record: { kind: 'contact' } })).status).toBe(400);
  });

  it('otro workspace: la ficha ajena es 404 y la lista no cuenta sus registros', async () => {
    const s = await setup('c3-other');
    session.user = asOwner(s.w.stranger);
    expect((await post({ record: { kind: 'contact', id: s.mine.id } })).status).toBe(404);
    const before = await sig({ list: 'contacts', ids: [s.mine.id, s.theirs.id] });
    await updateContact(s.ws, s.mine.id, { city: 'Rosario' });
    await createContact(s.ws, { firstName: 'New' });
    expect(await sig({ list: 'contacts', ids: [s.mine.id, s.theirs.id] })).toBe(before);
  });

  it('member sin acceso: la ficha de otro es 404 y sus cambios no mueven la firma', async () => {
    const s = await setup('c3-member');
    session.user = asMember(s.w.owner, s.w.member);
    expect((await post({ record: { kind: 'contact', id: s.theirs.id } })).status).toBe(404);
    const list = { list: 'contacts', ids: [s.mine.id, s.theirs.id] };
    const before = await sig(list);
    await updateContact(s.ws, s.theirs.id, { city: 'Córdoba' });
    await createContact(s.ws, { firstName: 'Hidden new', ownerId: s.w.friend.id });
    await createActivity(s.ws, { type: 'note', subject: 'n', body: 'x', contactId: s.theirs.id });
    expect(await sig(list)).toBe(before);
    // Un registro suyo nuevo sí.
    await createContact(s.ws, { firstName: 'Visible new', ownerId: s.w.member.id });
    expect(await sig(list)).not.toBe(before);
  });

  it('member con un campo oculto: cambiarlo no mueve la firma; un campo visible sí', async () => {
    const s = await setup('c3-hidden');
    session.user = asMember(s.w.owner, s.w.member);
    const rec = { record: { kind: 'contact', id: s.mine.id } };
    const list = { list: 'contacts', ids: [s.mine.id] };
    const [r0, l0] = [await sig(rec), await sig(list)];
    await updateContact(s.ws, s.mine.id, { custom: { secret: 'b' } });
    expect(await sig(rec)).toBe(r0);
    expect(await sig(list)).toBe(l0);
    await updateContact(s.ws, s.mine.id, { jobTitle: 'Buyer' });
    expect(await sig(rec)).not.toBe(r0);
    expect(await sig(list)).not.toBe(l0);
  });

  it('member: una empresa o actividad que no ve no cambia su ficha; una nota suya sí', async () => {
    const s = await setup('c3-assoc');
    const a = await createCompany(s.ws, { name: 'Hidden A', ownerId: s.w.friend.id });
    const b = await createCompany(s.ws, { name: 'Hidden B', ownerId: s.w.friend.id });
    await updateContact(s.ws, s.mine.id, { companyId: a.id });
    session.user = asMember(s.w.owner, s.w.member);
    const rec = { record: { kind: 'contact', id: s.mine.id } };
    const r0 = await sig(rec);
    await updateContact(s.ws, s.mine.id, { companyId: b.id });
    // Pasar de una empresa que no ve a otra que tampoco ve: igual para esta persona.
    expect(await sig(rec)).toBe(r0);
    await createActivity(s.ws, { type: 'note', subject: 'mine', body: 'x', contactId: s.mine.id, ownerId: s.w.member.id });
    expect(await sig(rec)).not.toBe(r0);
  });

  it('owner y admin: ven todo, también el campo oculto para members', async () => {
    const s = await setup('c3-owner');
    for (const user of [asOwner(s.w.owner), asMember(s.w.owner, s.w.friend, 'admin')]) {
      session.user = user;
      const rec = { record: { kind: 'contact', id: s.theirs.id } };
      const before = await sig(rec);
      await updateContact(s.ws, s.theirs.id, { custom: { secret: `v-${Math.random()}` } });
      expect(await sig(rec)).not.toBe(before);
    }
  });
});
