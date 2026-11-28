/**
 * CRM C5: el timeline muestra los cambios de propiedades (no solo el lifecycle
 * automático), con lo que cada persona ve. Acceso: anónimo, otro workspace,
 * miembro sin acceso, miembro con un campo oculto y owner. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, createDeal, createPipeline, createStage, moveDeal, updateContact, updateDeal } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { listPropertyChanges } from '@/lib/crm-timeline';
import { applyFilters } from '@/components/crm/timelineModel';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const timelineRoute = await import('@/app/api/crm/timeline/route');

beforeEach(() => {
  session.user = null;
});

const uid = () => Math.random().toString(36).slice(2, 8);

function getTimeline(kind: string, id: string) {
  return timelineRoute.GET(new NextRequest(`http://test.local/api/crm/timeline?kind=${kind}&id=${encodeURIComponent(id)}&offset=0`));
}

type Change = { field: string; label?: string; from: string; to: string; reason: string; actor?: string };
async function changesOf(res: Response): Promise<Change[]> {
  const body = (await res.json()) as { items: Array<{ type: string; change?: Change }> };
  return body.items.filter((i) => i.type === 'change').map((i) => i.change!);
}

/** Workspace con un contacto que cambió de lead status, cargo, owner, empresa y un campo propio oculto para members. */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const owner = { ...asOwner(w.owner), workspace: w.team } as SessionUser;
  const member = { ...asMember(w.owner, w.member), workspace: w.team } as SessionUser;
  const secret = await createCustomField(w.owner.id, { entity: 'contacts', name: `tier_${uid()}`, label: 'Internal tier', type: 'text' });
  await setFieldPermissions(w.owner.id, secret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  const visibleCo = await createCompany(w.owner.id, { name: `Open Co ${uid()}`, ownerId: w.member.id });
  const privateCo = await createCompany(w.owner.id, { name: `Private Co ${uid()}`, ownerId: w.friend.id });
  const contact = await createContact(w.owner.id, { firstName: 'Lena', lastName: `Moss${uid()}`, ownerId: w.member.id, companyId: visibleCo.id });
  await updateContact(w.owner.id, contact.id, { leadStatus: 'connected', jobTitle: 'Buyer' }, undefined, w.owner.email);
  await updateContact(w.owner.id, contact.id, { custom: { [secret.name]: 'gold' } }, undefined, w.owner.email);
  await updateContact(w.owner.id, contact.id, { companyId: privateCo.id }, undefined, w.owner.email);
  await updateContact(w.owner.id, contact.id, { ownerId: w.friend.id }, undefined, w.owner.email);
  await updateContact(w.owner.id, contact.id, { ownerId: w.member.id }, undefined, w.owner.email);
  return { w, owner, member, secret, visibleCo, privateCo, contact };
}

describe('timeline: cambios de propiedades', () => {
  it('owner: ve cada cambio, con nombres de owner y empresa y quién lo hizo', async () => {
    const s = await setup('c5-tl-owner');
    const changes = await listPropertyChanges(s.owner, { kind: 'contact', id: s.contact.id }, null);
    const byField = (f: string) => changes.filter((c) => c.change.field === f).map((c) => c.change);
    expect(byField('lead_status')[0]).toMatchObject({ to: 'connected', reason: '' });
    expect(byField('job_title')[0]).toMatchObject({ from: '', to: 'Buyer' });
    expect(byField(`custom.${s.secret.name}`)[0]).toMatchObject({ label: 'Internal tier', to: 'gold' });
    expect(byField('company_id')[0]).toMatchObject({ from: s.visibleCo.name, to: s.privateCo.name });
    // Owner: por nombre (o email), nunca el id.
    const owners = byField('owner_id');
    expect(owners).toHaveLength(2);
    for (const o of owners) {
      expect(o.from).not.toBe(s.w.member.id);
      expect(o.to).not.toBe(s.w.friend.id);
      expect(o.to).not.toBe('');
    }
    // Quién lo cambió: la persona del workspace.
    expect(byField('lead_status')[0].actor).toBe(s.w.owner.name || s.w.owner.email);
    // Lo más nuevo primero.
    expect(changes[0].change.field).toBe('owner_id');
  });

  it('member con un campo oculto: ese cambio no sale; una empresa que no ve queda sin nombre', async () => {
    const s = await setup('c5-tl-member');
    await setMemberVisibility(s.w.owner.id, 'mine');
    session.user = s.member;
    const res = await getTimeline('contact', s.contact.id);
    expect(res.status).toBe(200);
    const changes = await changesOf(res);
    expect(changes.some((c) => c.field.startsWith('custom.'))).toBe(false);
    expect(JSON.stringify(changes)).not.toContain('gold');
    expect(JSON.stringify(changes)).not.toContain('Internal tier');
    // La empresa que no ve: sin nombre y marcada como privada (no "quedó vacía").
    const company = changes.find((c) => c.field === 'company_id')! as Change & { toPrivate?: boolean };
    expect(company.from).toBe(s.visibleCo.name);
    expect(company.to).toBe('');
    expect(company.toPrivate).toBe(true);
    expect(JSON.stringify(changes)).not.toContain(s.privateCo.name);
    expect(changes.find((c) => c.field === 'lead_status')).toMatchObject({ to: 'connected' });

    // Un campo oculto no ocupa lugar en el tope: con el más nuevo oculto, el member igual recibe uno que ve.
    await updateContact(s.w.owner.id, s.contact.id, { custom: { [s.secret.name]: 'platinum' } }, undefined, s.w.owner.email);
    const top = await listPropertyChanges(s.member, { kind: 'contact', id: s.contact.id }, [s.w.member.id], 1);
    expect(top).toHaveLength(1);
    expect(top[0].change.field).toBe('owner_id');
    const ownerTop = await listPropertyChanges(s.owner, { kind: 'contact', id: s.contact.id }, null, 1);
    expect(ownerTop[0].change.field).toBe(`custom.${s.secret.name}`);
  });

  it('anónimo, otro workspace y member sin acceso al registro: nada', async () => {
    const s = await setup('c5-tl-deny');
    expect((await getTimeline('contact', s.contact.id)).status).toBe(401);
    session.user = asOwner(s.w.stranger);
    expect((await getTimeline('contact', s.contact.id)).status).toBe(404);
    expect(await listPropertyChanges(asOwner(s.w.stranger), { kind: 'contact', id: s.contact.id }, null)).toEqual([]);
    await setMemberVisibility(s.w.owner.id, 'mine');
    session.user = { ...asMember(s.w.owner, s.w.friend), workspace: s.w.team } as SessionUser;
    expect((await getTimeline('contact', s.contact.id)).status).toBe(404);
  });

  it('deal: los movimientos de etapa y el monto', async () => {
    const s = await setup('c5-tl-deal');
    const p = await createPipeline(s.w.owner.id, `P ${uid()}`);
    const first = (await createStage(s.w.owner.id, p.id, { name: 'Intro', probability: 10 }))!;
    const second = (await createStage(s.w.owner.id, p.id, { name: 'Proposal', probability: 50 }))!;
    const res = await createDeal(s.w.owner.id, { pipelineId: p.id, stageId: first.id, name: `Deal ${uid()}`, amount: 1000 });
    if (!res.ok) throw new Error(res.reason);
    await moveDeal(s.w.owner.id, res.deal.id, second.id, null, undefined, s.w.owner.email);
    await updateDeal(s.w.owner.id, res.deal.id, { amount: 2500 }, s.w.owner.email);
    session.user = s.owner;
    const changes = await changesOf(await getTimeline('deal', res.deal.id));
    expect(changes.find((c) => c.field === 'stage')).toMatchObject({ from: 'Intro', to: 'Proposal' });
    expect(changes.find((c) => c.field === 'amount')).toMatchObject({ from: '1000', to: '2500' });
  });
});

describe('timeline: filtro de cambios', () => {
  const base = { tab: 'all' as const, types: ['note' as const], users: null, query: '', associated: true };
  const items = [
    { id: 'n', type: 'note', subject: 'x', body: '', due_at: null, created_at: '2026-11-01 10:00:00', done: 0 as const, pinned: 0 as const },
    { id: 'c', type: 'change', subject: '', body: '', due_at: null, created_at: '2026-11-01 11:00:00', done: 0 as const, pinned: 0 as const },
  ];
  it('la casilla de cambios los muestra o los esconde; por defecto se ven', () => {
    expect(applyFilters(items, base).map((i) => i.id)).toEqual(['n', 'c']);
    expect(applyFilters(items, { ...base, changes: true }).map((i) => i.id)).toEqual(['n', 'c']);
    expect(applyFilters(items, { ...base, changes: false }).map((i) => i.id)).toEqual(['n']);
    // En otra pestaña no van.
    expect(applyFilters(items, { ...base, tab: 'note' }).map((i) => i.id)).toEqual(['n']);
  });
});
