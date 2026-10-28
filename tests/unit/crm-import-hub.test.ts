import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createHubspotSource } from '@/lib/crm-import-hubspot';
import { fakeDatasetFromToken, fakeHubspotFetch } from '@/lib/crm-import-fake';
import { RateLimiter } from '@/lib/crm-import-source';
import { createImportPreview, getImportJob, runImportStep, startImportJob } from '@/lib/crm-import-jobs';
import { addMember, createTeam } from '@/lib/teams';
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
    const page = await src.page('lists', null, []);
    expect(page.items).toEqual([
      { kind: 'list', id: '71', name: 'Newsletter', entity: 'contact', memberIds: ['5000', '5001', '5002'] },
      { kind: 'list', id: '72', name: 'Key accounts', entity: 'company', memberIds: ['1000'] },
    ]);
    expect(page.next).toBeNull();
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
});
