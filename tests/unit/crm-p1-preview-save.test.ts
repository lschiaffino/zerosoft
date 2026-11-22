/**
 * Vista previa editable (P1): lee y guarda por las mismas rutas que la ficha
 * (GET y PATCH /api/crm/<objeto>/<id>, más /custom-fields?entity= para saber
 * qué se edita). Acá se prueba esa ruta de guardado con las cuatro miradas
 * (anónimo, otro workspace, compañero sin acceso, owner) y los permisos por
 * campo: un campo de solo lectura no cambia y uno oculto no sale ni se pisa.
 * Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, createDeal, createPipeline, createStage } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const dealRoute = await import('@/lib/routes/crm/deals/[id]/route');
const contactRoute = await import('@/lib/routes/crm/contacts/[id]/route');
const companyRoute = await import('@/lib/routes/crm/companies/[id]/route');
const fieldsRoute = await import('@/app/api/crm/custom-fields/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = (url: string) => new NextRequest(url);

/**
 * Workspace con visibilidad "mine" para members: el deal y el contacto del
 * owner no los ve el compañero; los suyos sí. `locked` es de solo lectura y
 * `secret` oculto para el rol member.
 */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  await setMemberVisibility(ws, 'mine');
  for (const entity of ['contacts', 'companies', 'deals']) {
    const locked = await createCustomField(ws, { entity, name: 'locked', label: 'Locked', type: 'text' });
    await setFieldPermissions(ws, locked.id, [{ subject: MEMBER_SUBJECT, access: 'read' }]);
    const secret = await createCustomField(ws, { entity, name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(ws, secret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    await createCustomField(ws, { entity, name: 'notes', label: 'Notes', type: 'text' });
  }
  const pipeline = await createPipeline(ws, 'Sales');
  const stage = await createStage(ws, pipeline.id, { name: 'Discovery', probability: 10 });
  const custom = { locked: 'l-1', secret: 's-1', notes: 'n-1' };
  const dealOf = async (name: string, ownerId: string) => {
    const r = await createDeal(ws, { name, pipelineId: pipeline.id, stageId: stage!.id, amount: 100, ownerId, custom });
    if (!r.ok) throw new Error(r.reason);
    return r.deal;
  };
  const ownerDeal = await dealOf('Owner deal', ws);
  const memberDeal = await dealOf('Member deal', w.member.id);
  const ownerContact = await createContact(ws, { firstName: 'Owner', lastName: 'Contact', ownerId: ws, custom });
  const memberContact = await createContact(ws, { firstName: 'Member', lastName: 'Contact', ownerId: w.member.id, custom });
  const ownerCompany = await createCompany(ws, { name: 'Owner Co', ownerId: ws, custom });
  const memberCompany = await createCompany(ws, { name: 'Member Co', ownerId: w.member.id, custom });
  return { w, ws, ownerDeal, memberDeal, ownerContact, memberContact, ownerCompany, memberCompany };
}

async function storedCustom(table: 'crm_deals' | 'crm_contacts' | 'crm_companies', id: string): Promise<Record<string, unknown>> {
  const row = (await getDb().prepare(`SELECT custom FROM ${table} WHERE id = ?`).get(id)) as { custom: string };
  return JSON.parse(row.custom) as Record<string, unknown>;
}

describe('vista previa: guardar desde el panel (deal del owner)', () => {
  it('anónimo 401, otro workspace 404, compañero sin acceso 404, owner 200', async () => {
    const s = await setup('p1-roles');
    const expected = { anonymous: 401, other_workspace: 404, teammate: 404, owner: 200 } as const;
    for (const r of roles(s.w)) {
      session.user = r.user;
      const res = await dealRoute.PATCH(patch(`http://x/api/crm/deals/${s.ownerDeal.id}`, { nextStep: `step ${r.name}` }), ctx(s.ownerDeal.id));
      expect(res.status, r.name).toBe(expected[r.name]);
      // Tampoco lo lee: la vista previa no se abre con datos.
      const read = await dealRoute.GET(get(`http://x/api/crm/deals/${s.ownerDeal.id}`), ctx(s.ownerDeal.id));
      expect(read.status, `${r.name} GET`).toBe(r.name === 'owner' ? 200 : r.name === 'anonymous' ? 401 : 404);
    }
    const row = (await getDb().prepare('SELECT next_step FROM crm_deals WHERE id = ?').get(s.ownerDeal.id)) as { next_step: string };
    expect(row.next_step).toBe('step owner');
  });

  it('lo mismo con contactos y empresas', async () => {
    const s = await setup('p1-roles-2');
    for (const r of roles(s.w)) {
      session.user = r.user;
      const c = await contactRoute.PATCH(patch(`http://x/api/crm/contacts/${s.ownerContact.id}`, { jobTitle: 'X' }), ctx(s.ownerContact.id));
      const co = await companyRoute.PATCH(patch(`http://x/api/crm/companies/${s.ownerCompany.id}`, { industry: 'X' }), ctx(s.ownerCompany.id));
      const want = r.name === 'anonymous' ? 401 : r.name === 'owner' ? 200 : 404;
      expect(c.status, `${r.name} contact`).toBe(want);
      expect(co.status, `${r.name} company`).toBe(want);
    }
  });
});

describe('vista previa: permisos por campo para un member en su propio registro', () => {
  it('ve sus registros sin el campo oculto y con el de solo lectura marcado', async () => {
    const s = await setup('p1-fields');
    session.user = asMember(s.w.owner, s.w.member);
    const res = await dealRoute.GET(get(`http://x/api/crm/deals/${s.memberDeal.id}`), ctx(s.memberDeal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deal: { custom: string } };
    const custom = JSON.parse(body.deal.custom) as Record<string, unknown>;
    expect(custom.secret).toBeUndefined();
    expect(custom.locked).toBe('l-1');

    const defs = await fieldsRoute.GET(get('http://x/api/crm/custom-fields?entity=deals'));
    const rows = ((await defs.json()) as { rows: Array<{ name: string; access: string }> }).rows;
    expect(rows.find((d) => d.name === 'secret')).toBeUndefined();
    expect(rows.find((d) => d.name === 'locked')?.access).toBe('read');
    expect(rows.find((d) => d.name === 'notes')?.access).toBe('edit');
  });

  it('cambiar un campo de solo lectura da 403 y no guarda nada', async () => {
    const s = await setup('p1-readonly');
    session.user = asMember(s.w.owner, s.w.member);
    for (const [route, plural, id, table] of [
      [dealRoute, 'deals', s.memberDeal.id, 'crm_deals'],
      [contactRoute, 'contacts', s.memberContact.id, 'crm_contacts'],
      [companyRoute, 'companies', s.memberCompany.id, 'crm_companies'],
    ] as const) {
      const res = await route.PATCH(patch(`http://x/api/crm/${plural}/${id}`, { custom: { locked: 'changed', notes: 'n-1' } }), ctx(id));
      expect(res.status, plural).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('field_readonly');
      expect((await storedCustom(table, id)).locked).toBe('l-1');
    }
  });

  it('editar un campo editable (como manda el panel: custom sin el oculto) no borra ni revela el oculto', async () => {
    const s = await setup('p1-hidden');
    session.user = asMember(s.w.owner, s.w.member);
    // El panel manda el `custom` que leyó (sin `secret`) con el cambio.
    const res = await dealRoute.PATCH(patch(`http://x/api/crm/deals/${s.memberDeal.id}`, { custom: { locked: 'l-1', notes: 'n-2' } }), ctx(s.memberDeal.id));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { custom: string };
    expect(JSON.parse(out.custom).secret).toBeUndefined();
    const stored = await storedCustom('crm_deals', s.memberDeal.id);
    expect(stored).toMatchObject({ secret: 's-1', locked: 'l-1', notes: 'n-2' });

    // Tampoco puede escribir el oculto mandándolo a mano.
    const sneaky = await dealRoute.PATCH(patch(`http://x/api/crm/deals/${s.memberDeal.id}`, { custom: { secret: 'x', notes: 'n-2' } }), ctx(s.memberDeal.id));
    expect(sneaky.status).toBe(200);
    expect((await storedCustom('crm_deals', s.memberDeal.id)).secret).toBe('s-1');
  });

  it('el owner edita el de solo lectura (las reglas no le aplican)', async () => {
    const s = await setup('p1-owner');
    session.user = asOwner(s.w.owner);
    const res = await dealRoute.PATCH(
      patch(`http://x/api/crm/deals/${s.memberDeal.id}`, { custom: { locked: 'l-2', secret: 's-2', notes: 'n-1' } }),
      ctx(s.memberDeal.id),
    );
    expect(res.status).toBe(200);
    expect(await storedCustom('crm_deals', s.memberDeal.id)).toMatchObject({ locked: 'l-2', secret: 's-2' });
  });
});
