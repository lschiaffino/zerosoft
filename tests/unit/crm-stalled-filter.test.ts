import { describe, expect, it } from 'vitest';
import { createContact, createDeal, createPipeline, createStage, listDeals, updateStage } from '@/lib/crm';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

describe('CRM: filtro de deals estancados', () => {
  it('lista solo deals abiertos pasados del umbral de su etapa, contando actividad y emails', async () => {
    const u = await makeUser('stalled');
    const p = await createPipeline(u.id, 'Sales');
    const open = (await createStage(u.id, p.id, { name: 'Open' })) as { id: string };
    const fast = (await createStage(u.id, p.id, { name: 'Fast' })) as { id: string };
    await updateStage(u.id, fast.id, { rottingDays: 3 });
    const db = getDb();
    const mk = async (name: string, stageId: string, idle: number, contactIds: string[] = []) => {
      const r = await createDeal(u.id, { name, pipelineId: p.id, stageId, contactIds });
      if (!r.ok) throw new Error(r.reason);
      await db.prepare('UPDATE crm_deals SET updated_at = ? WHERE id = ?').run(daysAgo(idle), r.deal.id);
      return r.deal.id as string;
    };
    await mk('old', open.id, 20);
    await mk('fresh', open.id, 5);
    await mk('edge', open.id, 14);
    await mk('fast-old', fast.id, 4);
    await mk('fast-fresh', fast.id, 2);
    const c = await createContact(u.id, { email: 'b@stalled.test' });
    const withEmail = await mk('old-with-email', open.id, 30, [c.id]);
    const emailId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO crm_emails (id, user_id, contact_id, gmail_id, thread_id, direction, from_email, to_emails, subject, snippet, sent_at)
         VALUES (?, ?, ?, ?, '', 'in', 'b@stalled.test', 'me@a.test', 'Re', '', ?)`,
      )
      .run(emailId, u.id, c.id, crypto.randomUUID(), daysAgo(1));
    await db
      .prepare('INSERT OR IGNORE INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)')
      .run(emailId, c.id, u.id);

    const all = await listDeals(u.id, { pipelineId: p.id });
    expect(all.total).toBe(6);
    const stalled = await listDeals(u.id, { pipelineId: p.id, stalled: true });
    expect(stalled.rows.map((d) => d.name).sort()).toEqual(['fast-old', 'old']);
    expect(stalled.rows.some((d) => d.id === withEmail)).toBe(false);
  });

  it('ignora etapas ganadas y perdidas', async () => {
    const u = await makeUser('stalled2');
    const p = await createPipeline(u.id, 'Sales');
    const won = (await createStage(u.id, p.id, { name: 'Won' })) as { id: string };
    await getDb().prepare('UPDATE crm_stages SET is_won = 1 WHERE id = ?').run(won.id);
    const r = await createDeal(u.id, { name: 'closed', pipelineId: p.id, stageId: won.id });
    if (!r.ok) throw new Error(r.reason);
    await getDb().prepare('UPDATE crm_deals SET updated_at = ? WHERE id = ?').run(daysAgo(90), r.deal.id);
    expect((await listDeals(u.id, { pipelineId: p.id, stalled: true })).total).toBe(0);
  });
});
