/**
 * CRM, bloque P5: "Seleccionar todos los que coinciden", "Crear tareas" en
 * masa, "Exportar la vista", el filtro "Sin actividad", los filtros rápidos
 * por vista y la búsqueda del selector de asociaciones. El server vuelve a
 * evaluar el listado con quien pide: anónimo, otro workspace, miembro que no
 * ve el registro, miembro con un campo oculto y owner/admin. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createContact, createCustomField, createDeal, createPipeline, createStage, getContact, listContacts } from '@/lib/crm';
import { createTag } from '@/lib/crm-tags';
import { getDb } from '@/lib/db';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { resolveMatching } from '@/lib/crm-list-matching';
import { NO_QUICK_FILTERS, quickFiltersFor, quickFiltersParam, serializeQuickFilters } from '@/lib/crm-quick-filters';
import { pickViewState } from '@/lib/crm-views-shared';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const contactsBulk = await import('@/app/api/crm/contacts/bulk/route');
const dealsBulk = await import('@/app/api/crm/deals/bulk/route');
const exportRoute = await import('@/app/api/crm/export/route');
const tagsApply = await import('@/app/api/crm/tags/apply/route');
const assocSearch = await import('@/app/api/crm/associations/search/route');

beforeEach(() => {
  session.user = null;
});

const uid = () => Math.random().toString(36).slice(2, 8);
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const bulk = (body: unknown) => contactsBulk.POST(post('http://test.local/api/crm/contacts/bulk', body));
const count = async (res: Response) => ((await res.json()) as { count: number }).count;

/** Tres contactos con una marca en el nombre: dos del owner y uno del miembro. */
async function seed(label: string) {
  const w = await workspaceWithMember(label);
  await setMemberVisibility(w.owner.id, 'mine');
  const tag = uid();
  const a = await createContact(w.owner.id, { firstName: 'Match', lastName: `A ${tag}`, ownerId: w.owner.id });
  const b = await createContact(w.owner.id, { firstName: 'Match', lastName: `B ${tag}`, ownerId: w.owner.id });
  const m = await createContact(w.owner.id, { firstName: 'Match', lastName: `M ${tag}`, ownerId: w.member.id });
  return { w, tag, a, b, m };
}

describe('select all matching: the server re-evaluates the list with the actor', () => {
  it('count: anonymous 401, other workspace 0, member only what they see, owner everything', async () => {
    const { w, tag } = await seed('p5-count');
    const body = { action: 'count', matching: { query: `q=${tag}` } };

    expect((await bulk(body)).status).toBe(401);
    session.user = asOwner(w.stranger);
    expect(await count(await bulk(body))).toBe(0);
    session.user = asMember(w.owner, w.member);
    expect(await count(await bulk(body))).toBe(1);
    session.user = asOwner(w.owner);
    expect(await count(await bulk(body))).toBe(3);
  });

  it('a bulk edit on "all matching" touches only the records the member sees, never ids sent by the client', async () => {
    const { w, tag, a, m } = await seed('p5-assign');
    session.user = asMember(w.owner, w.member);
    // Ids que el cliente intenta colar junto a `matching`: no cuentan.
    const res = await bulk({ action: 'set_property', ids: [a.id], matching: { query: `q=${tag}` }, field: 'jobTitle', value: 'Changed' });
    expect(res.status).toBe(200);
    expect(await count(res)).toBe(1);
    expect((await getContact(w.owner.id, m.id))?.contact.job_title).toBe('Changed');
    expect((await getContact(w.owner.id, a.id))?.contact.job_title ?? '').not.toBe('Changed');
  });

  it('caps the number of records', async () => {
    const { w, tag } = await seed('p5-cap');
    const res = await resolveMatching(asOwner(w.owner), 'contacts', `q=${tag}`, 2);
    expect('ids' in res && res.ids.length).toBe(2);
    expect('total' in res && res.total).toBe(3);
  });

  it('a hidden field neither filters nor sorts for the member, and an advanced rule naming it is rejected', async () => {
    const { w, tag, a, b } = await seed('p5-hidden');
    const f = await createCustomField(w.owner.id, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(w.owner.id, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    await getDb().prepare(`UPDATE crm_contacts SET custom = json_object('secret', 'yes'), owner_id = ? WHERE id IN (?, ?)`).run(w.member.id, a.id, b.id);

    // Owner: filtra por el campo.
    const owner = await resolveMatching(asOwner(w.owner), 'contacts', `q=${tag}&custom_secret=yes`, 100);
    expect('ids' in owner && owner.total).toBe(2);
    // Miembro: el filtro por un campo que no ve no se aplica (no revela qué registros lo tienen).
    const member = await resolveMatching(asMember(w.owner, w.member), 'contacts', `q=${tag}&custom_secret=yes&sort=cf:secret`, 100);
    expect('ids' in member && member.total).toBe(3);
    const rule = encodeURIComponent(JSON.stringify({ v: 1, groups: [{ rules: [{ f: 'custom:secret', o: 'is', v: ['yes'] }] }] }));
    session.user = asMember(w.owner, w.member);
    const res = await bulk({ action: 'count', matching: { query: `q=${tag}&filters=${rule}` } });
    expect(res.status).toBe(400);
  });

  it('tags on all matching follow the same scope', async () => {
    const { w, tag, m } = await seed('p5-tags');
    const created = await createTag(w.owner.id, { name: `Tag ${tag}` });
    if (!created.ok) throw new Error('tag');
    const tagId = created.tag.id;
    session.user = asMember(w.owner, w.member);
    const res = await tagsApply.POST(post('http://test.local/api/crm/tags/apply', { tagId, entity: 'contact', action: 'add', matching: { query: `q=${tag}` } }));
    expect(await count(res)).toBe(1);
    const rows = (await getDb().prepare('SELECT record_id FROM crm_record_tags WHERE tag_id = ?').all(tagId)) as Array<{ record_id: string }>;
    expect(rows.map((r) => r.record_id)).toEqual([m.id]);
  });
});

describe('bulk create tasks', () => {
  it('one task per visible record, linked to it; other workspace creates none', async () => {
    const { w, tag, m } = await seed('p5-tasks');
    const body = { action: 'create_tasks', matching: { query: `q=${tag}` }, task: { subject: `Follow up ${tag}`, dueDate: '2026-12-01', assignTo: 'owner' } };
    expect((await bulk(body)).status).toBe(401);

    session.user = asOwner(w.stranger);
    expect(await count(await bulk(body))).toBe(0);

    session.user = asMember(w.owner, w.member);
    expect(await count(await bulk(body))).toBe(1);
    const tasks = (await getDb()
      .prepare("SELECT contact_id, owner_id, type, due_at FROM crm_activities WHERE user_id = ? AND subject = ?")
      .all(w.owner.id, `Follow up ${tag}`)) as Array<{ contact_id: string; owner_id: string; type: string; due_at: string | null }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ contact_id: m.id, owner_id: w.member.id, type: 'task' });
    expect(tasks[0].due_at).toMatch(/^2026-12-01/);

    session.user = asOwner(w.owner);
    expect(await count(await bulk({ ...body, task: { subject: `Owner ${tag}`, assignTo: 'me' } }))).toBe(3);
  });

  it('rejects a missing title', async () => {
    const { w, a } = await seed('p5-tasks2');
    session.user = asOwner(w.owner);
    expect((await bulk({ action: 'create_tasks', ids: [a.id], task: { subject: '  ' } })).status).toBe(400);
    expect((await bulk({ action: 'create_tasks', ids: [a.id] })).status).toBe(400);
  });

  it('deals: the matching query keeps the pipeline and a member only reaches their deals', async () => {
    const w = await workspaceWithMember('p5-deals');
    await setMemberVisibility(w.owner.id, 'mine');
    const tag = uid();
    const pipe = await createPipeline(w.owner.id, `P ${tag}`);
    await createStage(w.owner.id, pipe.id, { name: 'Open', probability: 10 });
    const stageId = (await getDb().prepare('SELECT id FROM crm_stages WHERE pipeline_id = ? LIMIT 1').get(pipe.id)) as { id: string };
    await createDeal(w.owner.id, { name: `Deal ${tag} 1`, pipelineId: pipe.id, stageId: stageId.id, ownerId: w.owner.id });
    await createDeal(w.owner.id, { name: `Deal ${tag} 2`, pipelineId: pipe.id, stageId: stageId.id, ownerId: w.member.id });
    const body = { action: 'count', matching: { query: `pipeline=${pipe.id}&view=table&q=${tag}` } };
    const run = () => dealsBulk.POST(post('http://test.local/api/crm/deals/bulk', body));
    session.user = asMember(w.owner, w.member);
    expect(await count(await run())).toBe(1);
    session.user = asOwner(w.owner);
    expect(await count(await run())).toBe(2);
    // Borrar todos los que coinciden: solo admins.
    session.user = asMember(w.owner, w.member);
    const del = await dealsBulk.POST(post('http://test.local/api/crm/deals/bulk', { action: 'delete', matching: body.matching }));
    expect(del.status).toBe(403);
  });
});

describe('export view', () => {
  const exportView = (query: string) =>
    exportRoute.GET(new NextRequest(`http://test.local/api/crm/export?entity=contacts&format=json&list=${encodeURIComponent(query)}`));

  it('anonymous 401, member 403, other workspace none of ours, owner the whole filtered view', async () => {
    const { w, tag, a, b, m } = await seed('p5-export');
    expect((await exportView(`q=${tag}`)).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    expect((await exportView(`q=${tag}`)).status).toBe(403);
    session.user = asOwner(w.stranger);
    expect(await (await exportView(`q=${tag}`)).json()).toEqual([]);
    session.user = asOwner(w.owner);
    const rows = (await (await exportView(`q=${tag}`)).json()) as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id, m.id].sort());
    // Con un filtro rápido (owner) exporta solo lo que la vista muestra.
    const mine = (await (await exportView(`q=${tag}&owner=${w.member.id}`)).json()) as Array<{ id: string }>;
    expect(mine.map((r) => r.id)).toEqual([m.id]);
  });

  it('an admin member exports only within their record scope, and list + ids together is rejected', async () => {
    const { w, tag, m } = await seed('p5-export2');
    session.user = asMember(w.owner, w.member, 'admin');
    // Admins ven todo (la visibilidad "mine" es para members).
    const rows = (await (await exportView(`q=${tag}`)).json()) as Array<{ id: string }>;
    expect(rows.length).toBe(3);
    const both = await exportRoute.GET(new NextRequest(`http://test.local/api/crm/export?entity=contacts&format=json&ids=${m.id}&list=q%3D${tag}`));
    expect(both.status).toBe(400);
  });
});

describe('association picker search', () => {
  const search = (q: string, type = 'contact', exclude = '') =>
    assocSearch.GET(new NextRequest(`http://test.local/api/crm/associations/search?type=${type}&q=${encodeURIComponent(q)}&exclude=${exclude}`));

  it('searches every visible record server-side, never one the person cannot see, and returns no custom properties', async () => {
    const { w, tag, a, m } = await seed('p5-assoc');
    expect((await search(tag)).status).toBe(401);
    session.user = asOwner(w.stranger);
    expect(((await (await search(tag)).json()) as { results: unknown[] }).results).toEqual([]);
    session.user = asMember(w.owner, w.member);
    const member = (await (await search(tag)).json()) as { results: Array<Record<string, unknown>> };
    expect(member.results.map((r) => r.id)).toEqual([m.id]);
    expect(Object.keys(member.results[0]).sort()).toEqual(['id', 'meta', 'name']);
    session.user = asOwner(w.owner);
    const owner = (await (await search(tag, 'contact', a.id)).json()) as { results: Array<{ id: string }> };
    expect(owner.results).toHaveLength(2);
    expect(owner.results.some((r) => r.id === a.id)).toBe(false);
    expect((await search(tag, 'lead')).status).toBe(400);
  });
});

describe('quick filters and "No activity"', () => {
  it('no activity returns only records without any activity', async () => {
    const { w, tag, a } = await seed('p5-noact');
    await getDb().prepare("UPDATE crm_contacts SET last_activity_at = '2026-11-01 10:00:00' WHERE id = ?").run(a.id);
    const { total } = await listContacts(w.owner.id, { q: tag, activityNone: true });
    expect(total).toBe(2);
  });

  it('a custom property quick filter now filters contacts', async () => {
    const { w, tag, a } = await seed('p5-custom');
    await getDb().prepare(`UPDATE crm_contacts SET custom = json_object('tier', 'gold') WHERE id = ?`).run(a.id);
    const { rows } = await listContacts(w.owner.id, { q: tag, custom: { tier: 'gold' } });
    expect(rows.map((r) => r.id)).toEqual([a.id]);
  });

  it('quick filter choice is normalized and saved with the view', () => {
    expect(serializeQuickFilters('owner, source,owner,bogus,tag')).toBe('owner,source,tag');
    expect(serializeQuickFilters('none')).toBe(NO_QUICK_FILTERS);
    expect(quickFiltersFor('contacts', '')).toEqual(['owner', 'created', 'activity', 'leadStatus', 'lifecycle']);
    expect(quickFiltersFor('contacts', 'source,industry')).toEqual(['source']);
    expect(quickFiltersFor('deals', NO_QUICK_FILTERS)).toEqual([]);
    expect(quickFiltersParam('companies', ['owner', 'created', 'activity', 'lifecycle', 'industry'])).toBeUndefined();
    expect(quickFiltersParam('companies', [])).toBe(NO_QUICK_FILTERS);
    expect(pickViewState('contacts', { qf: 'tag,owner', noActivity: '1', junk: 'x' })).toEqual({ qf: 'tag,owner', noActivity: '1' });
    expect(pickViewState('deals', { noActivity: 'yes' })).toEqual({});
  });
});
