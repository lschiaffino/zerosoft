import { describe, expect, it } from 'vitest';
import { createContact, createDeal, createPipeline, createStage, listDealsForBoard, updateStage } from '@/lib/crm';
import { DEFAULT_ROTTING_DAYS, dealIdleDays, isDealRotting, stageRottingDays } from '@/lib/crm-rotting';
import { stageUpdateSchema } from '@/lib/crm-schema';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const NOW = Date.parse('2026-06-30T12:00:00Z');

describe('CRM: deal rotting', () => {
  it('cuenta el último email como actividad', () => {
    const deal = { updated_at: '2026-05-01 00:00:00', last_activity_at: '2026-06-01 12:00:00', last_email_at: null };
    expect(dealIdleDays(deal, NOW)).toBe(29);
    expect(dealIdleDays({ ...deal, last_email_at: '2026-06-28 12:00:00' }, NOW)).toBe(2);
    // Sin actividad ni emails cae al último update.
    expect(dealIdleDays({ updated_at: '2026-06-20 12:00:00', last_activity_at: null }, NOW)).toBe(10);
  });

  it('usa el umbral de la etapa, con 14 por default, y nunca marca etapas cerradas', () => {
    const open = { is_won: 0, is_lost: 0, rotting_days: null };
    expect(stageRottingDays(open)).toBe(DEFAULT_ROTTING_DAYS);
    expect(isDealRotting(15, open)).toBe(true);
    expect(isDealRotting(14, open)).toBe(false);
    expect(isDealRotting(4, { ...open, rotting_days: 3 })).toBe(true);
    expect(isDealRotting(20, { ...open, rotting_days: 30 })).toBe(false);
    expect(isDealRotting(100, { is_won: 1, is_lost: 0, rotting_days: 3 })).toBe(false);
  });

  it('valida rottingDays en el PATCH de etapa (null vuelve al default)', () => {
    expect(stageUpdateSchema.safeParse({ rottingDays: 7 }).success).toBe(true);
    expect(stageUpdateSchema.safeParse({ rottingDays: null }).success).toBe(true);
    expect(stageUpdateSchema.safeParse({ rottingDays: 0 }).success).toBe(false);
    expect(stageUpdateSchema.safeParse({ rottingDays: 1.5 }).success).toBe(false);
  });

  it('el board trae el último email con los contactos del deal y guarda el umbral por etapa', async () => {
    const a = await makeUser('a');
    const p = await createPipeline(a.id, 'Sales');
    const s = (await createStage(a.id, p.id, { name: 'New' })) as { id: string };
    const stage = await updateStage(a.id, s.id, { rottingDays: 5 });
    expect(stage?.rotting_days).toBe(5);

    const c = await createContact(a.id, { email: 'buyer@a.test' });
    const res = await createDeal(a.id, { name: 'Deal', pipelineId: p.id, stageId: s.id, contactIds: [c.id] });
    if (!res.ok) throw new Error(res.reason);
    const emailId = crypto.randomUUID();
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO crm_emails (id, user_id, contact_id, gmail_id, thread_id, direction, from_email, to_emails, subject, snippet, sent_at)
         VALUES (?, ?, ?, ?, '', 'in', 'buyer@a.test', 'me@a.test', 'Re: propuesta', '', '2026-06-29 09:00:00')`,
      )
      .run(emailId, a.id, c.id, crypto.randomUUID());
    await db
      .prepare('INSERT OR IGNORE INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)')
      .run(emailId, c.id, a.id);

    const cols = await listDealsForBoard(a.id, p.id);
    const deal = cols[0].deals[0];
    expect(deal.last_email_at).toBe('2026-06-29 09:00:00');
    expect(cols[0].stage.rotting_days).toBe(5);

    expect((await updateStage(a.id, s.id, { rottingDays: null }))?.rotting_days).toBeNull();
  });
});
