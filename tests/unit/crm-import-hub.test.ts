import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createHubspotSource } from '@/lib/crm-import-hubspot';
import { fakeDatasetFromToken, fakeHubspotFetch } from '@/lib/crm-import-fake';
import { RateLimiter } from '@/lib/crm-import-source';
import { createImportPreview, getImportJob, runImportStep, startImportJob } from '@/lib/crm-import-jobs';
import { addMember, createTeam } from '@/lib/teams';
import { upsertUser } from '@/lib/db';
import { makeUser } from './helpers';

/**
 * Hub de importación: lo que se sumó a HubSpot → CRM (listas como etiquetas
 * y el chequeo de que quien creó el job todavía administra el workspace).
 */

beforeAll(() => {
  process.env.CRM_IMPORT_FAKE = '1';
});

async function runToEnd(jobId: string) {
  for (let i = 0; i < 500; i++) {
    const r = await runImportStep(jobId, { maxPages: 1 });
    if (r === 'done' || r === 'failed' || r === 'cancelled') return r;
  }
  return 'stuck';
}

describe('HubSpot: listas', () => {
  it('lee listas de contactos y empresas con sus miembros (paginado)', async () => {
    const src = createHubspotSource('fake', {
      fetch: fakeHubspotFetch(fakeDatasetFromToken('fake')),
      sleep: async () => {},
      limiter: new RateLimiter(Number.MAX_SAFE_INTEGER, 1),
    });
    expect(src.phases()).toContain('lists');
    expect(await src.count('lists')).toBe(2);
    // Una lista por tramo (con sus miembros paginados dentro del cursor).
    const page = await src.page('lists', null, []);
    expect(page.items).toEqual([{ kind: 'list', id: '71', name: 'Newsletter', entity: 'contact', memberIds: ['5000', '5001', '5002'], first: true }]);
    const page2 = await src.page('lists', page.next, []);
    expect(page2.items).toEqual([{ kind: 'list', id: '72', name: 'Key accounts', entity: 'company', memberIds: ['1000'], first: true }]);
    expect(page2.next).toBeNull();
  });

  it('el import las pasa a etiquetas en los registros importados, y reimportar no duplica', async () => {
    const u = await makeUser('hslists');
    const res = await createImportPreview(u.id, u.id, 'hubspot', 'fake');
    if (!res.ok) throw new Error(res.code);
    expect(res.job.preview.counts.lists).toBe(2);
    const started = await startImportJob(u.id, res.job.id, {
      groups: ['companies', 'contacts', 'lists'],
      ownerMap: res.job.options.ownerMap,
      defaultOwnerId: u.id,
    });
    if (!started.ok) throw new Error(started.code);
    expect(started.job.counts.lists.total).toBe(2);
    expect(await runToEnd(res.job.id)).toBe('done');
    const job = (await getImportJob(u.id, res.job.id))!;
    expect(job.counts.lists).toMatchObject({ processed: 2, created: 2 });
    const tags = (await getDb().prepare('SELECT id, name FROM crm_tags WHERE user_id = ? ORDER BY name').all(u.id)) as Array<{ id: string; name: string }>;
    expect(tags.map((t) => t.name)).toEqual(['Key accounts', 'Newsletter']);
    const count = async () =>
      (await getDb().prepare('SELECT entity, COUNT(*) AS n FROM crm_record_tags WHERE user_id = ? GROUP BY entity ORDER BY entity').all(u.id)) as Array<{
        entity: string;
        n: number;
      }>;
    expect(await count()).toEqual([
      { entity: 'company', n: 1 },
      { entity: 'contact', n: 3 },
    ]);

    const again = await createImportPreview(u.id, u.id, 'hubspot', 'fake');
    if (!again.ok) throw new Error(again.code);
    const s2 = await startImportJob(u.id, again.job.id, { groups: ['companies', 'contacts', 'lists'], ownerMap: {}, defaultOwnerId: u.id });
    if (!s2.ok) throw new Error(s2.code);
    expect(await runToEnd(again.job.id)).toBe('done');
    expect((await getImportJob(u.id, again.job.id))!.counts.lists).toMatchObject({ created: 0, updated: 2 });
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_tags WHERE user_id = ?').get(u.id)) as { n: number }).n).toBe(2);
    expect(await count()).toEqual([
      { entity: 'company', n: 1 },
      { entity: 'contact', n: 3 },
    ]);
  });

  it('un admin que deja de serlo: el job se corta', async () => {
    const owner = await makeUser('hsowner');
    const admin = await makeUser('hsadmin');
    const team = await createTeam(owner.id, 'Acme');
    await addMember(team.id, admin.id, 'admin');
    const res = await createImportPreview(owner.id, admin.id, 'hubspot', 'fake');
    if (!res.ok) throw new Error(res.code);
    const started = await startImportJob(owner.id, res.job.id, { groups: ['companies'], ownerMap: {}, defaultOwnerId: owner.id });
    if (!started.ok) throw new Error(started.code);
    await getDb().prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run('member', team.id, admin.id);
    expect(await runToEnd(res.job.id)).toBe('failed');
    expect((await getImportJob(owner.id, res.job.id))!.failure).toBe('forbidden');
  });

  it('owners que no eran miembros: al unirse reciben sus registros (salvo los reasignados a mano)', async () => {
    const u = await makeUser('hsclaim');
    const team = await createTeam(u.id, 'Acme');
    const other = await makeUser('hsother');
    await addMember(team.id, other.id, 'member');
    const res = await createImportPreview(u.id, u.id, 'hubspot', 'fake');
    if (!res.ok) throw new Error(res.code);
    // El owner "2" (sam@fake-crm.test) no está en el workspace: va al owner por defecto.
    expect(res.job.preview.owners.find((o) => o.id === '2')?.matchId).toBeNull();
    const started = await startImportJob(u.id, res.job.id, { groups: ['companies', 'contacts', 'deals', 'activities'], ownerMap: res.job.options.ownerMap, defaultOwnerId: u.id });
    if (!started.ok) throw new Error(started.code);
    expect(await runToEnd(res.job.id)).toBe('done');
    const db = getDb();
    const pending = (await db
      .prepare(`SELECT entity, record_id FROM crm_import_pending_owners WHERE workspace_id = ? AND email = 'sam@fake-crm.test' ORDER BY entity`)
      .all(u.id)) as Array<{ entity: string; record_id: string }>;
    const contacts = pending.filter((p) => p.entity === 'contact');
    expect(contacts.length).toBeGreaterThan(1);
    expect(pending.some((p) => p.entity === 'company')).toBe(true);
    expect(pending.some((p) => p.entity === 'deal')).toBe(true);
    // Alguien reasignó a mano un contacto mientras tanto: ese no se toca.
    await db.prepare('UPDATE crm_contacts SET owner_id = ? WHERE id = ?').run(other.id, contacts[0].record_id);

    // Sam se une al workspace (aceptar la invitación termina en addMember).
    const sam = await upsertUser({ id: `sam-${crypto.randomUUID().slice(0, 8)}`, email: 'sam@fake-crm.test', name: 'Sam', image: null });
    await addMember(team.id, sam.id, 'member');
    const owner = async (id: string) => ((await db.prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').get(id)) as { owner_id: string }).owner_id;
    expect(await owner(contacts[0].record_id)).toBe(other.id);
    expect(await owner(contacts[1].record_id)).toBe(sam.id);
    const deal = pending.find((p) => p.entity === 'deal')!;
    expect(((await db.prepare('SELECT owner_id FROM crm_deals WHERE id = ?').get(deal.record_id)) as { owner_id: string }).owner_id).toBe(sam.id);
    // Los del owner "1" (mapeado por email a quien importa) no esperaban a nadie.
    const left = (await db.prepare('SELECT COUNT(*) AS n FROM crm_import_pending_owners WHERE workspace_id = ?').get(u.id)) as { n: number };
    expect(left.n).toBe(0);
    const mine = (await db.prepare('SELECT COUNT(*) AS n FROM crm_contacts WHERE user_id = ? AND owner_id = ?').get(u.id, u.id)) as { n: number };
    expect(mine.n).toBeGreaterThan(0);
  });

  it('reimportar no pisa registros editados en zerosoft, salvo con "Reemplazar"', async () => {
    const u = await makeUser('hslocal');
    const run = async (overwriteLocal: boolean) => {
      const res = await createImportPreview(u.id, u.id, 'hubspot', 'fake');
      if (!res.ok) throw new Error(res.code);
      const s = await startImportJob(u.id, res.job.id, { groups: ['companies', 'contacts'], ownerMap: res.job.options.ownerMap, defaultOwnerId: u.id, overwriteLocal });
      if (!s.ok) throw new Error(s.code);
      expect(await runToEnd(res.job.id)).toBe('done');
      return { preview: res.job.preview, job: (await getImportJob(u.id, res.job.id))! };
    };
    await run(false);
    const db = getDb();
    const c = (await db.prepare(`SELECT id FROM crm_contacts WHERE user_id = ? AND email = 'person1@company1.example'`).get(u.id)) as { id: string };
    await db.prepare(`UPDATE crm_contacts SET first_name = 'Mine', job_title = '', updated_at = '2999-01-01 00:00:00' WHERE id = ?`).run(c.id);

    const second = await run(false);
    expect(second.preview.locallyEdited).toBe(1);
    expect(second.job.counts.contacts.kept).toBe(1);
    expect(second.job.counts.contacts.updated).toBe(23);
    const row = (await db.prepare('SELECT first_name FROM crm_contacts WHERE id = ?').get(c.id)) as { first_name: string };
    expect(row.first_name).toBe('Mine');

    const third = await run(true);
    expect(third.job.counts.contacts.kept ?? 0).toBe(0);
    expect(((await db.prepare('SELECT first_name FROM crm_contacts WHERE id = ?').get(c.id)) as { first_name: string }).first_name).toBe('Person1');
  });
});
