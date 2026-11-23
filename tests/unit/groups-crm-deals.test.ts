/**
 * Lines: los negocios de la pestaña CRM del panel de un chat (lib/groups-crm-deals.ts). Solo los del contacto o la
 * empresa vinculados al chat, del mismo workspace, abiertos primero; nada sin la app CRM ni de un chat de otro
 * workspace.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createNumber, upsertChat } from '@/lib/groups';
import { chatCrmDeals } from '@/lib/groups-crm-deals';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
});

const owner = (u: { id: string; email: string }, blockedApps: string[] = []) => ({ id: u.id, email: u.email, name: 'x', role: 'owner', apps: '*', blockedApps }) as never;

async function setup(label: string) {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  const chat = await upsertChat({ id: n.id, user_id: u.id }, { providerChatId: `1203630${Date.now()}${label.length}@g.us`, kind: 'group', name: 'Clientes' }, { silent: true });
  const db = getDb();
  const id = (p: string) => `${p}_${label}_${Math.random().toString(36).slice(2, 8)}`;
  const [company, other, pipeline, open, won] = [id('co'), id('co'), id('pl'), id('st'), id('st')];
  await db.prepare("INSERT INTO crm_companies (id, user_id, name, created_at, updated_at) VALUES (?, ?, 'Acme', datetime('now'), datetime('now'))").run(company, u.id);
  await db.prepare("INSERT INTO crm_companies (id, user_id, name, created_at, updated_at) VALUES (?, ?, 'Otra', datetime('now'), datetime('now'))").run(other, u.id);
  await db.prepare("INSERT INTO crm_pipelines (id, user_id, name) VALUES (?, ?, 'Ventas')").run(pipeline, u.id);
  await db.prepare("INSERT INTO crm_stages (id, pipeline_id, name, position) VALUES (?, ?, 'Propuesta', 1)").run(open, pipeline);
  await db.prepare("INSERT INTO crm_stages (id, pipeline_id, name, position, is_won) VALUES (?, ?, 'Ganado', 2, 1)").run(won, pipeline);
  const deal = async (name: string, stage: string, co: string) => {
    const d = id('dl');
    await db.prepare("INSERT INTO crm_deals (id, user_id, pipeline_id, stage_id, name, amount, currency) VALUES (?, ?, ?, ?, ?, 1200, 'USD')").run(d, u.id, pipeline, stage, name);
    await db.prepare('INSERT INTO crm_deal_companies (deal_id, company_id, user_id) VALUES (?, ?, ?)').run(d, co, u.id);
    return d;
  };
  await deal('Renovación', won, company);
  await deal('Ampliación', open, company);
  await deal('De otra empresa', open, other);
  await db.prepare('UPDATE groups_chats SET crm_company_id = ? WHERE id = ?').run(company, chat.id);
  return { u, chatId: chat.id };
}

describe('chatCrmDeals', () => {
  it('trae los negocios de la empresa vinculada, abiertos primero, con etapa y monto', async () => {
    const { u, chatId } = await setup('deals-on');
    const deals = await chatCrmDeals(owner(u), u.id, chatId);
    expect(deals.map((d) => [d.name, d.stage, d.state, d.amount])).toEqual([
      ['Ampliación', 'Propuesta', 'open', 1200],
      ['Renovación', 'Ganado', 'won', 1200],
    ]);
  });

  it('sin la app CRM no trae nada', async () => {
    const { u, chatId } = await setup('deals-off');
    expect(await chatCrmDeals(owner(u, ['crm']), u.id, chatId)).toEqual([]);
  });

  it('el chat de otro workspace no trae nada', async () => {
    const { chatId } = await setup('deals-a');
    const other = await makeUser('deals-b');
    expect(await chatCrmDeals(owner(other), other.id, chatId)).toEqual([]);
  });

  it('sin vínculo no trae nada', async () => {
    const { u, chatId } = await setup('deals-none');
    await getDb().prepare('UPDATE groups_chats SET crm_company_id = NULL WHERE id = ?').run(chatId);
    expect(await chatCrmDeals(owner(u), u.id, chatId)).toEqual([]);
  });
});
