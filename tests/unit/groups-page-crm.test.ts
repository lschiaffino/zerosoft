/**
 * Lines: la sección CRM de los detalles de un chat solo con la app CRM abierta
 * para quien mira (Apps del workspace y las apps de la persona). Con CRM
 * apagado el servidor no manda nada del CRM, y el vínculo del chat queda.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createNumber, upsertChat } from '@/lib/groups';
import { loadChatPage } from '@/lib/groups-page';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
});

async function setup(label: string) {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  const chat = await upsertChat({ id: n.id, user_id: u.id }, { providerChatId: `1203630${Date.now()}@g.us`, kind: 'group', name: 'Clientes' }, { silent: true });
  const db = getDb();
  const companyId = `co_${label}_${Date.now()}`;
  await db.prepare("INSERT INTO crm_companies (id, user_id, name, created_at, updated_at) VALUES (?, ?, 'Acme', datetime('now'), datetime('now'))").run(companyId, u.id);
  await db.prepare('UPDATE groups_chats SET crm_company_id = ? WHERE id = ?').run(companyId, chat.id);
  return { ws: u.id, email: u.email, chatId: chat.id, companyId };
}

describe('loadChatPage: CRM según la app', () => {
  it('con CRM abierto trae la empresa vinculada', async () => {
    const { ws, email, chatId, companyId } = await setup('crm-on');
    const page = await loadChatPage({ id: ws, email, name: 'x', role: 'owner', apps: '*', blockedApps: [] } as never, chatId);
    expect(page?.crm).toEqual({ contact: null, company: { id: companyId, name: 'Acme' } });
    expect(page?.chat.crmCompanyId).toBe(companyId);
  });

  it('con CRM apagado en el workspace no manda nada del CRM y el vínculo queda', async () => {
    const { ws, email, chatId, companyId } = await setup('crm-off');
    const page = await loadChatPage({ id: ws, email, name: 'x', role: 'owner', apps: '*', blockedApps: ['crm'] } as never, chatId);
    expect(page?.crm).toBeNull();
    expect(page?.chat.crmCompanyId).toBeNull();
    const row = (await getDb().prepare('SELECT crm_company_id FROM groups_chats WHERE id = ?').get(chatId)) as { crm_company_id: string };
    expect(row.crm_company_id).toBe(companyId);
  });

  it('una persona sin CRM entre sus apps tampoco lo ve', async () => {
    const { ws, email, chatId } = await setup('crm-member');
    const page = await loadChatPage({ id: ws, email, name: 'x', role: 'admin', apps: ['lines'], blockedApps: [] } as never, chatId);
    expect(page?.crm).toBeNull();
  });
});
