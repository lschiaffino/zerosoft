import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { createAgent } from '@/lib/agents';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { asMember, roles, workspaceWithMember } from './access-helpers';

/**
 * Un agente asignado a un chat de Lines guarda los mensajes del chat en una
 * conversación de Agents: esa conversación sigue el acceso por línea del chat.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const listRoute = await import('@/lib/routes/agents/[id]/conversations/route');
const detailRoute = await import('@/lib/routes/agents/[id]/conversations/[cid]/route');
const exportRoute = await import('@/lib/routes/agents/[id]/export/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const n = await createNumber(w.owner.id, w.owner.id, { provider: 'fake', name: 'Private line' });
  await connectNumber(w.owner.id, n.id);
  const line = (await getNumberRowById(n.id))!;
  await ingestEvents(line, [
    { type: 'message', chatId: '5490000000001@c.us', isGroup: false, fromMe: false, senderPhone: '5490000000001', senderName: 'Client', providerMessageId: 'm-1', body: 'private text' },
  ]);
  // Línea restringida: solo friend (además de admins y dueño).
  await setLineAccess(w.owner.id, line.id, { ownerId: w.friend.id, visibility: 'restricted', personIds: [], teamIds: [] });
  const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
  const agent = await createAgent(w.owner.id, w.owner.id, { name: 'lines agent' });
  const convId = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare(`INSERT INTO agent_conversations (id, agent_id, user_id, channel, title, created_at, updated_at) VALUES (?, ?, ?, 'api', 'Client', ?, ?)`)
    .run(convId, agent.id, w.owner.id, now, now);
  await getDb()
    .prepare('INSERT INTO agent_messages (id, conversation_id, role, content, run_id, author_id, ui, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)')
    .run(crypto.randomUUID(), convId, 'user', 'Client: private text', now);
  await getDb().prepare('UPDATE groups_chats SET agent_id = ?, agent_conversation_id = ? WHERE id = ?').run(agent.id, convId, chat.id);
  return { w, agent, convId };
}

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

describe('Agents: conversaciones que vienen de un chat de Lines', () => {
  it('anónimo, otro workspace y compañero sin la línea no la ven; owner y quien tiene la línea, sí', async () => {
    const { w, agent, convId } = await setup('ag-lines');
    const listUrl = new NextRequest(`http://x/api/agents/${agent.id}/conversations`);
    const expectations = { anonymous: false, other_workspace: false, teammate: false, owner: true };
    for (const r of roles(w)) {
      session.user = r.user ? ({ ...r.user, apps: '*' } as SessionUser) : null;
      const list = await listRoute.GET(listUrl, ctx({ id: agent.id }));
      const ids = list.status === 200 ? ((await list.json()) as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id) : [];
      expect(ids.includes(convId), `${r.name} list`).toBe(expectations[r.name]);
      const detail = await detailRoute.GET(new NextRequest(`http://x/api/agents/${agent.id}/conversations/${convId}`), ctx({ id: agent.id, cid: convId }));
      expect(detail.status === 200, `${r.name} detail`).toBe(expectations[r.name]);
      const csv = await exportRoute.GET(new NextRequest(`http://x/api/agents/${agent.id}/export`), ctx({ id: agent.id }));
      const text = csv.status === 200 ? await csv.text() : '';
      expect(text.includes(convId), `${r.name} export`).toBe(expectations[r.name]);
    }

    // Quien tiene la línea la ve.
    session.user = asMember(w.owner, w.friend);
    const list = await listRoute.GET(listUrl, ctx({ id: agent.id }));
    const ids = ((await list.json()) as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id);
    expect(ids).toContain(convId);
  });
});
