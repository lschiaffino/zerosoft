import { describe, expect, it } from 'vitest';
import {
  createActivity,
  createCompany,
  createContact,
  createDeal,
  createPipeline,
  createStage,
  deleteActivity,
  deleteCompany,
  deleteContact,
  deleteDeal,
  getContact,
  listContacts,
  listDeals,
  listTasks,
  searchAll,
  updateActivity,
  updateStage,
  createCustomField,
} from '@/lib/crm';
import { associateContactCompany, setParentCompany } from '@/lib/crm-assoc';
import { applyTag, createTag, tagsForRecords } from '@/lib/crm-tags';
import { listTrash, purgeExpiredTrash, purgeTrash, restoreTrash, trashDaysLeft } from '@/lib/crm-trash';
import { buildBulkPatch, bulkSetProperty, coerceCustomValue } from '@/lib/crm-bulk';
import { nextRepeatDue } from '@/lib/crm-task-repeat';
import { activityDateOrder } from '@/lib/crm-activity-dates';
import { getDb, type CrmActivityRow } from '@/lib/db';
import { makeUser } from './helpers';

async function pipelineFor(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const open = await createStage(userId, p.id, { name: 'New' });
  const won = await createStage(userId, p.id, { name: 'Won', probability: 100 });
  await updateStage(userId, won!.id, { isWon: true });
  return { pipelineId: p.id, stageId: open!.id, wonStageId: won!.id };
}

async function contactRow(id: string) {
  return (await getDb().prepare('SELECT * FROM crm_contacts WHERE id = ?').get(id)) as
    | { company_id: string | null; last_activity_at: string | null; last_contacted_at: string | null; next_activity_at: string | null }
    | undefined;
}

describe('papelera del CRM', () => {
  it('borrar un contacto lo saca de listas y búsqueda; restaurar devuelve asociaciones, tags y actividades', async () => {
    const u = await makeUser('trash');
    const co = await createCompany(u.id, { name: 'Acme' });
    const c = await createContact(u.id, { firstName: 'Ada', lastName: 'Trash', email: 'ada@trash.test' });
    await associateContactCompany(u.id, c.id, co.id, { primary: true });
    const tagRes = await createTag(u.id, { name: 'VIP' });
    if (!tagRes.ok) throw new Error('tag');
    const tag = tagRes.tag;
    await applyTag(u.id, tag.id, 'contact', [c.id], 'add');
    const { pipelineId, stageId } = await pipelineFor(u.id);
    const dealRes = await createDeal(u.id, { name: 'Deal A', pipelineId, stageId, contactIds: [c.id] });
    if (!dealRes.ok) throw new Error('deal');
    const own = await createActivity(u.id, { type: 'task', subject: 'Llamar a Ada', contactId: c.id, dueAt: '2030-01-01 10:00' });
    const shared = await createActivity(u.id, { type: 'note', subject: 'Nota compartida', contactId: c.id, dealId: dealRes.deal.id });

    expect(await deleteContact(u.id, c.id, 'admin@test.local')).toBe(true);
    expect((await listContacts(u.id, { q: 'Ada' })).total).toBe(0);
    expect((await searchAll(u.id, 'Ada')).contacts).toHaveLength(0);
    // La tarea propia se fue con el contacto; la nota que también apunta al deal se queda.
    expect((await listTasks(u.id, 'upcoming')).some((t) => t.id === own.id)).toBe(false);
    expect(await getDb().prepare('SELECT 1 FROM crm_activities WHERE id = ?').get(own.id)).toBeUndefined();
    expect(await getDb().prepare('SELECT 1 FROM crm_activities WHERE id = ?').get(shared.id)).toBeTruthy();

    const bin = await listTrash(u.id);
    expect(bin).toHaveLength(1);
    expect(bin[0]).toMatchObject({ entity: 'contact', record_id: c.id, label: 'Ada Trash', deleted_by: 'admin@test.local' });
    expect(trashDaysLeft(bin[0].deleted_at)).toBe(90);

    const res = await restoreTrash(u.id, bin[0].id);
    expect(res).toEqual({ ok: true, entity: 'contact', recordId: c.id });
    const detail = await getContact(u.id, c.id);
    expect(detail?.contact.email).toBe('ada@trash.test');
    expect(detail?.companies.map((x) => x.id)).toEqual([co.id]);
    expect((await contactRow(c.id))?.company_id).toBe(co.id);
    expect(detail?.deals.map((d) => d.id)).toEqual([dealRes.deal.id]);
    expect((await tagsForRecords(u.id, 'contact', [c.id])).get(c.id)?.map((x) => x.id)).toEqual([tag.id]);
    expect(await getDb().prepare('SELECT 1 FROM crm_activities WHERE id = ?').get(own.id)).toBeTruthy();
    expect((await contactRow(c.id))?.next_activity_at).toBe('2030-01-01 10:00');
    expect(await listTrash(u.id)).toHaveLength(0);
    expect(await restoreTrash(u.id, bin[0].id)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('empresa: restaura la jerarquía y la primaria del contacto vuelve como secundaria si ya hay otra', async () => {
    const u = await makeUser('trash-co');
    const parent = await createCompany(u.id, { name: 'Holding' });
    const child = await createCompany(u.id, { name: 'Filial' });
    const other = await createCompany(u.id, { name: 'Otra' });
    await setParentCompany(u.id, child.id, parent.id);
    const c = await createContact(u.id, { firstName: 'Bo' });
    await associateContactCompany(u.id, c.id, parent.id, { primary: true });
    await associateContactCompany(u.id, c.id, other.id);

    expect(await deleteCompany(u.id, parent.id)).toBe(true);
    expect((await contactRow(c.id))?.company_id).toBe(other.id);
    const [entry] = await listTrash(u.id, { entity: 'company' });
    expect((await restoreTrash(u.id, entry.id)).ok).toBe(true);
    const childRow = (await getDb().prepare('SELECT parent_company_id FROM crm_companies WHERE id = ?').get(child.id)) as {
      parent_company_id: string | null;
    };
    expect(childRow.parent_company_id).toBe(parent.id);
    const links = (await getDb()
      .prepare('SELECT company_id, is_primary FROM crm_contact_companies WHERE contact_id = ? ORDER BY company_id')
      .all(c.id)) as Array<{ company_id: string; is_primary: number }>;
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.company_id === other.id)?.is_primary).toBe(1);
    expect(links.find((l) => l.company_id === parent.id)?.is_primary).toBe(0);
  });

  it('deal y actividad sueltos; scope por owner; purga manual y a los 90 días', async () => {
    const u = await makeUser('trash-deal');
    const { pipelineId, stageId } = await pipelineFor(u.id);
    const d = await createDeal(u.id, { name: 'Gone', pipelineId, stageId });
    if (!d.ok) throw new Error('deal');
    const note = await createActivity(u.id, { type: 'note', subject: 'Suelta' });
    expect(await deleteDeal(u.id, d.deal.id)).toBe(true);
    expect(await deleteActivity(u.id, note.id)).toBe(true);
    expect((await listDeals(u.id, { pipelineId })).total).toBe(0);
    expect(await listTrash(u.id)).toHaveLength(2);
    expect(await listTrash(u.id, { ownerScope: ['someone-else'] })).toHaveLength(0);
    expect(await listTrash(u.id, { entity: 'activity', q: 'Suel' })).toHaveLength(1);

    const dealEntry = (await listTrash(u.id, { entity: 'deal' }))[0];
    expect(await restoreTrash(u.id, dealEntry.id, ['someone-else'])).toEqual({ ok: false, reason: 'not_found' });
    expect((await restoreTrash(u.id, dealEntry.id)).ok).toBe(true);
    expect((await listDeals(u.id, { pipelineId })).total).toBe(1);

    // Otra cuenta no ve ni toca la papelera ajena.
    const other = await makeUser('trash-other');
    expect(await listTrash(other.id)).toHaveLength(0);

    await getDb()
      .prepare("UPDATE crm_trash SET deleted_at = datetime('now', '-91 days') WHERE user_id = ?")
      .run(u.id);
    expect(await purgeExpiredTrash()).toBeGreaterThanOrEqual(1);
    expect(await listTrash(u.id)).toHaveLength(0);

    const n2 = await createActivity(u.id, { type: 'note', subject: 'Otra' });
    await deleteActivity(u.id, n2.id);
    expect(await purgeTrash(u.id, 'all')).toBe(1);
  });
});

describe('fechas de actividad', () => {
  it('se mantienen al crear, completar, mover y borrar actividades', async () => {
    const u = await makeUser('dates');
    const c = await createContact(u.id, { firstName: 'Cy' });
    expect((await contactRow(c.id))?.last_activity_at).toBeNull();

    const call = await createActivity(u.id, { type: 'call', subject: 'Llamada', contactId: c.id });
    let row = await contactRow(c.id);
    expect(row?.last_activity_at).toBe(call.created_at);
    expect(row?.last_contacted_at).toBe(call.created_at);

    const inbound = await createActivity(u.id, { type: 'email', subject: 'Entrante', direction: 'inbound', contactId: c.id });
    await getDb().prepare("UPDATE crm_activities SET created_at = '2099-01-01 00:00:00' WHERE id = ?").run(inbound.id);
    row = await contactRow(c.id);
    expect(row?.last_activity_at).toBe('2099-01-01 00:00:00');
    expect(row?.last_contacted_at).toBe(call.created_at);

    const t1 = await createActivity(u.id, { type: 'task', subject: 'A', contactId: c.id, dueAt: '2031-05-01 09:00' });
    await createActivity(u.id, { type: 'task', subject: 'B', contactId: c.id, dueAt: '2030-05-01 09:00' });
    expect((await contactRow(c.id))?.next_activity_at).toBe('2030-05-01 09:00');

    const c2 = await createContact(u.id, { firstName: 'Dee' });
    await updateActivity(u.id, t1.id, { contactId: c2.id });
    expect((await contactRow(c2.id))?.next_activity_at).toBe('2031-05-01 09:00');

    await deleteActivity(u.id, inbound.id);
    expect((await contactRow(c.id))?.last_activity_at).toBe(call.created_at);
  });

  it('ordena y filtra por las fechas con los vacíos al final', async () => {
    const u = await makeUser('dates-sort');
    const a = await createContact(u.id, { firstName: 'Sin' });
    const b = await createContact(u.id, { firstName: 'Pronto' });
    const c = await createContact(u.id, { firstName: 'Tarde' });
    await createActivity(u.id, { type: 'task', subject: 'x', contactId: b.id, dueAt: '2030-01-01' });
    await createActivity(u.id, { type: 'task', subject: 'y', contactId: c.id, dueAt: '2032-01-01' });
    const asc = await listContacts(u.id, { sort: 'next_activity' });
    expect(asc.rows.map((r) => r.id)).toEqual([b.id, c.id, a.id]);
    const desc = await listContacts(u.id, { sort: 'next_activity_desc' });
    expect(desc.rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    const filtered = await listContacts(u.id, {
      filters: [{ f: 'nextActivity', o: 'after', v: '2031-01-01' }],
    });
    expect(filtered.rows.map((r) => r.id)).toEqual([c.id]);
    expect(activityDateOrder('c', 'lastActivity', 'desc')).toBe('c.last_activity_at IS NULL, c.last_activity_at DESC, c.id');
  });
});

describe('edición en masa', () => {
  it('valida propiedades y custom fields', () => {
    expect(buildBulkPatch('contact', 'lifecycleStage', 'customer')).toEqual({ kind: 'field', patch: { lifecycleStage: 'customer' } });
    expect(buildBulkPatch('contact', 'lifecycleStage', 'nope')).toBeNull();
    expect(buildBulkPatch('contact', 'email', 'x@y.z')).toBeNull();
    expect(buildBulkPatch('company', 'ownerId', null)).toEqual({ kind: 'field', patch: { ownerId: null } });
    expect(buildBulkPatch('deal', 'currency', 'eur')).toEqual({ kind: 'field', patch: { currency: 'EUR' } });
    expect(buildBulkPatch('deal', 'stageId', 'st-1')).toEqual({ kind: 'stage', stageId: 'st-1' });
    expect(buildBulkPatch('company', 'employees', 12)).toEqual({ kind: 'field', patch: { employees: 12 } });
    const defs = [{ name: 'tier', type: 'select' as const, options: '["a","b"]' }];
    expect(buildBulkPatch('contact', 'custom:tier', 'b', defs)).toEqual({ kind: 'custom', name: 'tier', value: 'b' });
    expect(buildBulkPatch('contact', 'custom:tier', 'z', defs)).toBeNull();
    expect(buildBulkPatch('contact', 'custom:missing', 'a', defs)).toBeNull();
    expect(coerceCustomValue({ type: 'number', options: '[]' }, '4.5')).toBe(4.5);
    expect(coerceCustomValue({ type: 'boolean', options: '[]' }, 'false')).toBe(false);
    expect(coerceCustomValue({ type: 'date', options: '[]' }, '2026-13')).toBeUndefined();
    expect(coerceCustomValue({ type: 'text', options: '[]' }, '')).toBeNull();
  });

  it('reasigna owner, cambia propiedades, custom fields y etapa de deals', async () => {
    const u = await makeUser('bulk');
    const a = await createContact(u.id, { firstName: 'A', custom: { keep: 'yes' } });
    const b = await createContact(u.id, { firstName: 'B' });
    expect(await bulkSetProperty(u.id, 'contact', [a.id, b.id], 'leadStatus', 'connected')).toEqual({ ok: true, count: 2, failed: 0, blocked: 0 });
    expect(await bulkSetProperty(u.id, 'contact', [a.id], 'ownerId', 'not-a-member')).toEqual({ ok: false, code: 'invalid_owner' });
    expect((await bulkSetProperty(u.id, 'contact', [a.id, b.id], 'ownerId', u.id)).ok).toBe(true);

    await createCustomField(u.id, { entity: 'contacts', name: 'score_band', label: 'Band', type: 'number' });
    expect(await bulkSetProperty(u.id, 'contact', [a.id, b.id], 'custom:score_band', '3')).toEqual({ ok: true, count: 2, failed: 0, blocked: 0 });
    const rowA = (await getDb().prepare('SELECT lead_status, custom FROM crm_contacts WHERE id = ?').get(a.id)) as {
      lead_status: string;
      custom: string;
    };
    expect(rowA.lead_status).toBe('connected');
    expect(JSON.parse(rowA.custom)).toEqual({ keep: 'yes', score_band: 3 });
    const events = (await getDb()
      .prepare("SELECT COUNT(*) AS n FROM crm_property_events WHERE entity = 'contact' AND entity_id = ?")
      .get(a.id)) as { n: number };
    expect(events.n).toBeGreaterThan(0);

    const { pipelineId, stageId, wonStageId } = await pipelineFor(u.id);
    const d = await createDeal(u.id, { name: 'D', pipelineId, stageId });
    if (!d.ok) throw new Error('deal');
    expect(await bulkSetProperty(u.id, 'deal', [d.deal.id, 'missing'], 'stageId', wonStageId)).toEqual({ ok: true, count: 1, failed: 1, blocked: 0 });
    const deal = (await getDb().prepare('SELECT stage_id, closed_at FROM crm_deals WHERE id = ?').get(d.deal.id)) as {
      stage_id: string;
      closed_at: string | null;
    };
    expect(deal.stage_id).toBe(wonStageId);
    expect(deal.closed_at).not.toBeNull();
  });
});

describe('tareas que se repiten', () => {
  it('calcula el próximo vencimiento', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(nextRepeatDue('2026-10-20 09:00', 'daily', now)).toBe('2026-10-21 09:00');
    expect(nextRepeatDue('2026-10-01 09:00:00', 'daily', now)).toBe('2026-10-21 09:00:00');
    expect(nextRepeatDue('2026-10-20', 'weekly', now)).toBe('2026-10-27');
    expect(nextRepeatDue('2026-10-14', 'daily', now)).toBe('2026-10-21');
    expect(nextRepeatDue('2027-01-31 10:00', 'monthly', now)).toBe('2027-02-28 10:00');
    expect(nextRepeatDue('2026-01-31 10:00', 'monthly', now)).toBe('2026-10-31 10:00');
    expect(nextRepeatDue('2026-12-15', 'monthly', now)).toBe('2027-01-15');
    expect(nextRepeatDue(null, 'weekly', now)).toBe('2026-10-27 12:00');
    expect(nextRepeatDue('2026-10-20', 'none', now)).toBeNull();
  });

  it('completar crea la siguiente una sola vez', async () => {
    const u = await makeUser('repeat');
    const c = await createContact(u.id, { firstName: 'Rita' });
    const task = await createActivity(u.id, {
      type: 'task',
      subject: 'Reporte semanal',
      body: 'cuerpo',
      contactId: c.id,
      dueAt: '2099-03-02 09:00',
      repeat: 'weekly',
    });
    expect(task.repeat).toBe('weekly');
    const done = await updateActivity(u.id, task.id, { done: true });
    expect(done?.repeat_next_id).toBeTruthy();
    const next = (await getDb().prepare('SELECT * FROM crm_activities WHERE id = ?').get(done!.repeat_next_id!)) as CrmActivityRow;
    expect(next).toMatchObject({ subject: 'Reporte semanal', body: 'cuerpo', contact_id: c.id, due_at: '2099-03-09 09:00', done: 0, repeat: 'weekly' });
    // Reabrir y volver a completar no duplica.
    await updateActivity(u.id, task.id, { done: false });
    await updateActivity(u.id, task.id, { done: true });
    const series = (await getDb()
      .prepare("SELECT COUNT(*) AS n FROM crm_activities WHERE subject = 'Reporte semanal' AND user_id = ?")
      .get(u.id)) as { n: number };
    expect(series.n).toBe(2);
    // Una nota nunca se repite.
    const note = await createActivity(u.id, { type: 'note', subject: 'n', repeat: 'daily' });
    expect(note.repeat).toBe('none');
  });
});
