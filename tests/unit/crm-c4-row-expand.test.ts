/**
 * CRM, bloque C4: la fila desplegada de los índices (GET /api/crm/row-expand).
 * Quién ve qué: anónimo, otro workspace, compañero sin acceso al registro,
 * compañero con acceso (y una propiedad oculta), owner y admin. Los
 * asociados y la última actividad cuentan solo lo que cada uno ve. Los datos
 * son inventados.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createActivity, createCompany, createContact, createCustomField, createDeal, createPipeline, createStage } from '@/lib/crm';
import { getDb } from '@/lib/db';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { activityLine, ROW_EXPAND_LIMIT, type RowExpansion } from '@/lib/crm-row-expand';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember, type AccessWorkspace } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (orig) => ({ ...((await orig()) as object), after: () => undefined }));

const route = await import('@/app/api/crm/row-expand/route');

async function expand(user: SessionUser | null, type: string, id: string): Promise<{ status: number; body: RowExpansion | null; raw: string }> {
  session.user = user;
  const res = await route.GET(new NextRequest(`http://x/api/crm/row-expand?type=${type}&id=${encodeURIComponent(id)}`));
  const raw = await res.text();
  return { status: res.status, body: res.ok ? (JSON.parse(raw) as RowExpansion) : null, raw };
}

const ids = (rows: Array<{ id: string }> | undefined) => (rows ?? []).map((r) => r.id).sort();

let w: AccessWorkspace;
const rec = {} as Record<'company' | 'k1' | 'k2' | 'd1' | 'd2' | 'd3' | 'friendCompany', string>;

beforeAll(async () => {
  w = await workspaceWithMember('c4x');
  // Cada persona ve solo lo suyo (y el owner y los admins, todo).
  await setMemberVisibility(w.owner.id, 'mine');
  const secret = await createCustomField(w.owner.id, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
  await setFieldPermissions(w.owner.id, secret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);

  const p = await createPipeline(w.owner.id, 'Sales');
  const open = (await createStage(w.owner.id, p.id, { name: 'Demo' }))!;
  const won = (await createStage(w.owner.id, p.id, { name: 'Won' }))!;
  await getDb().prepare('UPDATE crm_stages SET is_won = 1 WHERE id = ?').run(won.id);

  rec.company = (await createCompany(w.owner.id, { name: 'Acme Rowexp', domain: 'acme-rowexp.test', ownerId: w.member.id })).id;
  rec.friendCompany = (await createCompany(w.owner.id, { name: 'Friend Co', domain: 'friend-rowexp.test', ownerId: w.friend.id })).id;
  rec.k1 = (
    await createContact(w.owner.id, { firstName: 'Kim', lastName: 'Visible', email: 'kim@rowexp.test', jobTitle: 'Buyer', companyId: rec.company, ownerId: w.member.id, custom: { secret: 'TOPSECRET-1' } })
  ).id;
  rec.k2 = (await createContact(w.owner.id, { firstName: 'Lee', lastName: 'Hidden', email: 'lee@rowexp.test', companyId: rec.company, ownerId: w.friend.id })).id;

  const deal = async (name: string, stageId: string, ownerId: string, contactIds: string[], companyId: string) => {
    const r = await createDeal(w.owner.id, { name, pipelineId: p.id, stageId, amount: 1200, currency: 'USD', ownerId, contactIds, companyId });
    if (!r.ok) throw new Error(r.reason);
    return r.deal.id;
  };
  rec.d1 = await deal('Open mine', open.id, w.member.id, [rec.k1, rec.k2], rec.company);
  rec.d2 = await deal('Open friend', open.id, w.friend.id, [rec.k1], rec.company);
  rec.d3 = await deal('Won mine', won.id, w.member.id, [rec.k1], rec.company);

  // La nota sobre el contacto de otra persona es la más nueva, pero el member no la ve.
  await createActivity(w.owner.id, { type: 'note', body: 'Visible note on the company', companyId: rec.company, ownerId: w.member.id });
  await new Promise((r) => setTimeout(r, 1100));
  await createActivity(w.owner.id, { type: 'note', body: 'HIDDEN-NOTE from a teammate', contactId: rec.k2, ownerId: w.friend.id });
});

beforeEach(() => {
  session.user = null;
});

describe('row expansion: who sees what', () => {
  it('anonymous gets 401', async () => {
    expect((await expand(null, 'company', rec.company)).status).toBe(401);
  });

  it('another workspace gets 404, even its owner', async () => {
    const r = await expand(asOwner(w.stranger), 'company', rec.company);
    expect(r.status).toBe(404);
    expect(r.raw).not.toContain('Acme');
  });

  it('a member without access to the record gets 404', async () => {
    const r = await expand(asMember(w.owner, w.friend), 'company', rec.company);
    expect(r.status).toBe(404);
    expect(r.raw).not.toContain('Kim');
  });

  it('a member with access sees only their associations and activity, never a hidden property', async () => {
    const member = asMember(w.owner, w.member);
    const company = await expand(member, 'company', rec.company);
    expect(company.status).toBe(200);
    expect(ids(company.body!.contacts!.rows)).toEqual([rec.k1]);
    expect(company.body!.contacts!.total).toBe(1);
    // Abiertos y que ve: el ganado y el de su compañero no.
    expect(ids(company.body!.deals!.rows)).toEqual([rec.d1]);
    expect(company.body!.deals!.total).toBe(1);
    expect(company.body!.lastActivity?.text).toBe('Visible note on the company');
    expect(company.raw).not.toContain('HIDDEN-NOTE');
    expect(company.raw).not.toContain('Lee');
    expect(company.raw).not.toContain('TOPSECRET');
    expect(company.raw).not.toContain('secret');

    const contact = await expand(member, 'contact', rec.k1);
    expect(contact.status).toBe(200);
    // Abiertos primero; el de su compañero no sale.
    expect(contact.body!.deals!.rows.map((d) => d.id)).toEqual([rec.d1, rec.d3]);
    expect(contact.body!.deals!.rows[1].status).toBe('won');
    expect(contact.body!.deals!.total).toBe(2);
    expect(contact.raw).not.toContain('TOPSECRET');

    const deal = await expand(member, 'deal', rec.d1);
    expect(ids(deal.body!.contacts!.rows)).toEqual([rec.k1]);
    expect(deal.body!.contacts!.rows[0]).toEqual({ id: rec.k1, name: 'Kim Visible', email: 'kim@rowexp.test', jobTitle: 'Buyer' });
    expect(deal.body!.companies!.rows).toEqual([{ id: rec.company, name: 'Acme Rowexp', domain: 'acme-rowexp.test', primary: true }]);

    // Un deal de su compañero no existe para él.
    expect((await expand(member, 'deal', rec.d2)).status).toBe(404);
    expect((await expand(member, 'contact', rec.k2)).status).toBe(404);
  });

  it('owner and admin see every association and the newest activity', async () => {
    for (const user of [asOwner(w.owner), asMember(w.owner, w.friend, 'admin')]) {
      const company = await expand(user, 'company', rec.company);
      expect(company.status).toBe(200);
      expect(ids(company.body!.contacts!.rows)).toEqual([rec.k1, rec.k2].sort());
      expect(ids(company.body!.deals!.rows)).toEqual([rec.d1, rec.d2].sort());
      expect(company.body!.lastActivity?.text).toBe('HIDDEN-NOTE from a teammate');
      const deal = await expand(user, 'deal', rec.d1);
      expect(ids(deal.body!.contacts!.rows)).toEqual([rec.k1, rec.k2].sort());
      // Nunca propiedades propias, ni para quien las ve.
      expect(company.raw).not.toContain('TOPSECRET');
    }
  });

  it('bad input is 400; an unknown id is 404', async () => {
    const owner = asOwner(w.owner);
    expect((await expand(owner, 'lead', rec.company)).status).toBe(400);
    expect((await expand(owner, 'company', '')).status).toBe(400);
    expect((await expand(owner, 'company', 'x'.repeat(65))).status).toBe(400);
    expect((await expand(owner, 'company', 'does-not-exist')).status).toBe(404);
    // Un id de otro tipo tampoco.
    expect((await expand(owner, 'company', rec.k1)).status).toBe(404);
  });
});

describe('row expansion: shape', () => {
  it('lists up to the limit and counts all the visible ones', async () => {
    const big = await createCompany(w.owner.id, { name: 'Big Rowexp' });
    for (let i = 0; i < ROW_EXPAND_LIMIT + 2; i++) await createContact(w.owner.id, { firstName: `P${i}`, email: `p${i}@big-rowexp.test`, companyId: big.id });
    const r = await expand(asOwner(w.owner), 'company', big.id);
    expect(r.body!.contacts!.rows).toHaveLength(ROW_EXPAND_LIMIT);
    expect(r.body!.contacts!.total).toBe(ROW_EXPAND_LIMIT + 2);
    expect(r.body!.deals).toEqual({ rows: [], total: 0 });
    expect(r.body!.lastActivity).toBeNull();
  });

  it('activity text is one short line without tags', () => {
    expect(activityLine('', '<p>Hello\n\n<b>there</b></p>')).toBe('Hello there');
    expect(activityLine('Subject wins', 'body')).toBe('Subject wins');
    const long = activityLine('', 'x'.repeat(500));
    expect(long.length).toBe(140);
    expect(long.endsWith('…')).toBe(true);
  });
});
