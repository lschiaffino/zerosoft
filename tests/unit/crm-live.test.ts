/**
 * CRM en vivo (bloque C3): los triggers suben el contador del workspace y
 * marcan el registro; la consulta de una pantalla dice si cambió algo de lo
 * que muestra, sin ids. Y anterior/siguiente: la posición en la vista.
 * Nombres inventados.
 */
import { describe, expect, it } from 'vitest';
import {
  createActivity,
  createCompany,
  createContact,
  createDeal,
  createPipeline,
  createStage,
  deleteContact,
  updateActivity,
  updateContact,
} from '@/lib/crm';
import { associateContactCompany } from '@/lib/crm-assoc';
import { crmLiveCheck, crmLiveRev, parseCrmLiveWatch } from '@/lib/crm-live';
import { navPosition, navTarget } from '@/components/crm/recordNavContext';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

describe('CRM en vivo', () => {
  it('un alta, un cambio y un borrado suben el contador y avisan a la tabla y a la ficha', async () => {
    const u = await makeUser('live');
    const before = await crmLiveRev(u.id);
    const c = await createContact(u.id, { firstName: 'Ada', lastName: 'Live', email: 'ada@live.test' });
    const afterCreate = await crmLiveRev(u.id);
    expect(afterCreate).toBeGreaterThan(before);

    // Nada cambió desde el contador actual.
    expect(await crmLiveCheck(u.id, afterCreate, { entities: ['contact'] })).toEqual({ rev: afterCreate, changed: false, gone: false });

    await updateContact(u.id, c.id, { jobTitle: 'Ingeniera' });
    const afterUpdate = await crmLiveRev(u.id);
    expect(afterUpdate).toBeGreaterThan(afterCreate);
    expect((await crmLiveCheck(u.id, afterCreate, { entities: ['contact'] })).changed).toBe(true);
    // La tabla de empresas no mira contactos.
    expect((await crmLiveCheck(u.id, afterCreate, { entities: ['company'] })).changed).toBe(false);
    // La ficha de ese contacto sí; la de otro, no.
    expect((await crmLiveCheck(u.id, afterCreate, { entities: [], record: { entity: 'contact', id: c.id } })).changed).toBe(true);
    const other = await createContact(u.id, { firstName: 'Otro', email: 'otro@live.test' });
    const afterOther = await crmLiveRev(u.id);
    await updateContact(u.id, c.id, { city: 'Rosario' });
    expect((await crmLiveCheck(u.id, afterOther, { entities: [], record: { entity: 'contact', id: other.id } })).changed).toBe(false);

    const beforeDelete = await crmLiveRev(u.id);
    expect(await deleteContact(u.id, c.id, 'admin@test.local')).toBe(true);
    const gone = await crmLiveCheck(u.id, beforeDelete, { entities: [], record: { entity: 'contact', id: c.id } });
    expect(gone.changed).toBe(true);
    expect(gone.gone).toBe(true);
  });

  it('otro workspace no se entera', async () => {
    const a = await makeUser('live-a');
    const b = await makeUser('live-b');
    const revB = await crmLiveRev(b.id);
    await createContact(a.id, { firstName: 'Solo', email: 'solo@live.test' });
    expect(await crmLiveRev(b.id)).toBe(revB);
    expect((await crmLiveCheck(b.id, revB, { entities: ['contact'] })).changed).toBe(false);
  });

  it('columnas de mantenimiento no cuentan; asociaciones y notas avisan a las dos fichas', async () => {
    const u = await makeUser('live-assoc');
    const c = await createContact(u.id, { firstName: 'Bea', email: 'bea@live.test' });
    const co = await createCompany(u.id, { name: 'Acme Live' });

    let rev = await crmLiveRev(u.id);
    await getDb().prepare('UPDATE crm_contacts SET score_updated_at = ? WHERE id = ?').run('2030-01-01 00:00:00', c.id);
    expect(await crmLiveRev(u.id)).toBe(rev);

    await associateContactCompany(u.id, c.id, co.id, { primary: true });
    expect((await crmLiveCheck(u.id, rev, { entities: [], record: { entity: 'company', id: co.id } })).changed).toBe(true);
    expect((await crmLiveCheck(u.id, rev, { entities: [], record: { entity: 'contact', id: c.id } })).changed).toBe(true);

    const note = await createActivity(u.id, { type: 'note', subject: 'Primera', contactId: c.id });
    rev = await crmLiveRev(u.id);
    await updateActivity(u.id, note.id, { body: 'Texto editado' });
    expect((await crmLiveCheck(u.id, rev, { entities: [], record: { entity: 'contact', id: c.id } })).changed).toBe(true);
  });

  it('borrar un negocio con contactos asociados no falla por el trigger de la asociación', async () => {
    const u = await makeUser('live-deal');
    const p = await createPipeline(u.id, 'Ventas');
    const s = await createStage(u.id, p.id, { name: 'Nuevo' });
    const c = await createContact(u.id, { firstName: 'Cata', email: 'cata@live.test' });
    const d = await createDeal(u.id, { name: 'Negocio vivo', pipelineId: p.id, stageId: s!.id, contactIds: [c.id] });
    if (!d.ok) throw new Error('deal');
    const rev = await crmLiveRev(u.id);
    await getDb().prepare('DELETE FROM crm_deals WHERE id = ?').run(d.deal.id);
    const state = await crmLiveCheck(u.id, rev, { entities: ['deal'] });
    expect(state.changed).toBe(true);
  });

  it('la query de la pantalla: entidades conocidas y un registro', () => {
    expect(parseCrmLiveWatch(new URLSearchParams('w=contact,company,nope'))).toEqual({ entities: ['contact', 'company'], record: null });
    expect(parseCrmLiveWatch(new URLSearchParams('r=deal:abc'))).toEqual({ entities: [], record: { entity: 'deal', id: 'abc' } });
    expect(parseCrmLiveWatch(new URLSearchParams('w=nope&r=bad:1'))).toBeNull();
  });
});

describe('anterior / siguiente en la ficha', () => {
  it('posición en la vista', () => {
    expect(navPosition(['a', 'b', 'c'], 3, 'b')).toEqual({ index: 2, total: 3, prev: 'a', next: 'c' });
    expect(navPosition(['a', 'b', 'c'], 40, 'a')).toEqual({ index: 1, total: 40, prev: null, next: 'b' });
    expect(navPosition(['a', 'b'], 2, 'b')).toEqual({ index: 2, total: 2, prev: 'a', next: null });
    expect(navPosition(['a', 'b'], 2, 'z')).toBeNull();
  });

  it('la ficha de contactos, empresas y negocios; no la de leads', () => {
    expect(navTarget('/app/crm/contacts/x1')).toEqual({ entity: 'contacts', id: 'x1' });
    expect(navTarget('/app/crm/deals/d-2')).toEqual({ entity: 'deals', id: 'd-2' });
    expect(navTarget('/app/crm/leads/l1')).toBeNull();
  });
});
