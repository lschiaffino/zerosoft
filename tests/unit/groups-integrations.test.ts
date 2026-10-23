import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createFlow } from '@/lib/flow';
import { runFlowNow } from '@/lib/flow-http';
import { searchApps } from '@/lib/app-search';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatsForCrmRecord, connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { summarizeChat } from '@/lib/groups-ai';
import { createTicket } from '@/lib/groups-tickets';
import { createCompany } from '@/lib/crm';
import { createAgent, updateAgent } from '@/lib/agents';
import { setAiModelOverride } from '@/lib/ai';
import { makeUser } from './helpers';
import { mockModel } from './ai-mock';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return { user, row: (await getNumberRowById(n.id))! };
}

const msg = (chatId: string, id: string, body: string, senderName = 'Ana') => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: '5491155550000',
  senderName,
  providerMessageId: id,
  body,
});

describe('Groups con el resto de la suite', () => {
  it('el resumen AI falla limpio con la AI apagada', async () => {
    vi.stubEnv('AI_ENABLED', 'false');
    const { user, row } = await setup('gi-ai');
    await ingestEvents(row, [msg('5491155557777@c.us', 'AI-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await expect(summarizeChat(user.id, chat.id)).rejects.toMatchObject({ name: 'AiError', code: 'ai_disabled' });
  });

  it('Cmd+K encuentra chats de Groups por nombre', async () => {
    const { user, row } = await setup('gi-search');
    await ingestEvents(row, [msg('5491155556666@c.us', 'S-1', 'hola', 'Zoe Buscable')]);
    const items = await searchApps({ id: user.id }, 'Buscable');
    expect(items.find((i) => i.group === 'groupsChats')).toMatchObject({ label: 'Zoe Buscable' });
  });

  it('un flow manda un WhatsApp con el nodo de Groups', async () => {
    const { user, row } = await setup('gi-flow');
    await ingestEvents(row, [msg('5491155555555@c.us', 'FL-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const flow = await createFlow(user.id, user.id, {
      name: 'wa',
      graph: {
        nodes: [
          { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'wa', type: 'app.groups_message', position: { x: 0, y: 0 }, config: { chatId: chat.id, body: 'desde flow' } },
        ],
        edges: [{ id: 'e1', source: 't', target: 'wa' }],
      },
    });
    if (!flow.ok) throw new Error('flow');
    const res = await runFlowNow(user.id, flow.flow.id, undefined);
    expect(res.ok && res.run?.status).toBe('success');
    expect(fakeSent(row.id).some((s) => s.text === 'desde flow')).toBe(true);
  });

  it('un agente de Agents contesta en el grupo por el mismo número', async () => {
    const { user, row } = await setup('gi-agent');
    const created = await createAgent(user.id, user.id, { name: 'Soporte' });
    await updateAgent(user.id, created.id, { enabled: true });
    setAiModelOverride(mockModel('Hola Ana, ya lo reviso.'));
    try {
      await ingestEvents(row, [msg('120363000000000002@g.us', 'AG-0', 'primer mensaje')]);
      const chat = (await listChats(user.id, user.id)).rows[0];
      await updateChat(user.id, chat.id, { agentId: created.id });
      await ingestEvents(row, [msg('120363000000000002@g.us', 'AG-1', '¿Me reenvían la factura?')]);
      expect(fakeSent(row.id).map((s) => s.text)).toContain('Hola Ana, ya lo reviso.');
      const after = (await listChats(user.id, user.id)).rows[0];
      expect(after.awaitingSince).toBeNull();
    } finally {
      setAiModelOverride(null);
    }
  });

  it('la ficha del CRM ve los mensajes y tickets del grupo vinculado', async () => {
    const { user, row } = await setup('gi-crm');
    const company = await createCompany(user.id, { name: 'Acme' } as never);
    await ingestEvents(row, [msg('120363000000000001@g.us', 'CRM-1', 'No llegó la factura')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await updateChat(user.id, chat.id, { crmCompanyId: (company as { id: string }).id });
    await createTicket(user.id, user.id, { chatId: chat.id, title: 'Factura' });
    const linked = await chatsForCrmRecord(user.id, 'company', (company as { id: string }).id);
    expect(linked).toHaveLength(1);
    expect(linked[0].messages.map((m) => m.body)).toEqual(['No llegó la factura']);
    expect(linked[0].openTickets).toBe(1);
    // Otro workspace no puede vincular una empresa ajena.
    const other = await makeUser('gi-crm-other');
    await expect(updateChat(other.id, chat.id, { crmCompanyId: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    const raw = (await getDb().prepare('SELECT crm_company_id FROM groups_chats WHERE id = ?').get(chat.id)) as { crm_company_id: string };
    expect(raw.crm_company_id).toBe((company as { id: string }).id);
  });
});
