/**
 * Séptima pasada: el email diario de tareas y los recordatorios del CRM
 * respetan Apps del workspace (si el CRM se apaga para la persona, no le
 * llega nada), y un envío desde un workflow de HubSpot con la key de un
 * miembro no cuenta ni usa chats de líneas que esa persona no ve. Datos
 * inventados; teléfonos de prueba.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivity } from '@/lib/crm';
import { digestTasksFor } from '@/lib/crm-task-digest';
import { reminderRecipientSees } from '@/lib/crm-task-reminders';
import { saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { createApiKey } from '@/lib/api-auth';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { connectHubspot, linkHubspot } from '@/lib/groups-hubspot';
import { resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { addMember } from '@/lib/teams';
import { getDb, type CrmActivityRow } from '@/lib/db';
import { workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const sendRoute = await import('@/app/api/v1/groups/hubspot/send/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});

describe('email diario y recordatorios: con el CRM apagado para la persona, nada', () => {
  it('Apps del workspace solo para admins: el miembro no recibe; owner y admin sí', async () => {
    const w = await workspaceWithMember('dig7');
    const ws = w.owner.id;
    const adminPerson = await makeUser('dig7-admin');
    await addMember(w.team.id, adminPerson.id, 'admin');
    const due = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const task = await createActivity(ws, { type: 'task', subject: 'Call back', dueAt: due, ownerId: w.member.id });
    const ownerTask = await createActivity(ws, { type: 'task', subject: 'Owner call', dueAt: due, ownerId: ws });
    const adminTask = await createActivity(ws, { type: 'task', subject: 'Admin call', dueAt: due, ownerId: adminPerson.id });
    const row = async (id: string) => (await getDb().prepare('SELECT * FROM crm_activities WHERE id = ?').get(id)) as CrmActivityRow;
    expect((await digestTasksFor(ws, w.member.id, 'UTC', new Date(), 'en'))?.map((t) => t.id)).toEqual([task.id]);
    expect(await reminderRecipientSees(await row(task.id), w.member.id)).toBe(true);

    await saveWorkspaceAppRule(ws, 'crm', { mode: 'admins', people: [], teams: [], denied: [] }, ws);
    expect(await digestTasksFor(ws, w.member.id, 'UTC', new Date(), 'en')).toBeNull();
    expect(await reminderRecipientSees(await row(task.id), w.member.id)).toBe(false);
    expect((await digestTasksFor(ws, adminPerson.id, 'UTC', new Date(), 'en'))?.map((t) => t.id)).toEqual([adminTask.id]);
    expect(await reminderRecipientSees(await row(adminTask.id), adminPerson.id)).toBe(true);
    expect((await digestTasksFor(ws, ws, 'UTC', new Date(), 'en'))?.map((t) => t.id)).toEqual([ownerTask.id]);
    expect(await reminderRecipientSees(await row(ownerTask.id), ws)).toBe(true);
    // Otro workspace: nada de este.
    expect(await reminderRecipientSees(await row(task.id), w.stranger.id)).toBe(false);
  });
});

describe('HubSpot workflow con la key de un miembro: solo chats de líneas que ve', () => {
  it('no cuenta ni usa el grupo vinculado de una línea que no ve', async () => {
    const w = await workspaceWithMember('hsw7');
    const ws = w.owner.id;
    const open = await createNumber(ws, ws, { provider: 'fake', name: 'Open', visibility: 'all' });
    const closed = await createNumber(ws, ws, { provider: 'fake', name: 'Closed', visibility: 'restricted' });
    for (const n of [open, closed]) {
      await connectNumber(ws, n.id);
      const st = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
      if (st) st.connectedAt = Date.now() - 5000;
    }
    const msg = (chatId: string, id: string, name: string) => ({
      type: 'message' as const,
      chatId,
      isGroup: true,
      chatName: name,
      fromMe: false,
      senderPhone: '15550101000',
      senderName: 'X',
      providerMessageId: id,
      body: 'hi',
    });
    await ingestEvents((await getNumberRowById(open.id))!, [msg('120363000000070001@g.us', 'hsw7-a', 'Open group')]);
    await ingestEvents((await getNumberRowById(closed.id))!, [msg('120363000000070002@g.us', 'hsw7-b', 'Closed group')]);
    await connectHubspot(ws, ws, 'pat-na1-fake-token-for-tests');
    const rows = (await listChats(ws, ws, { kind: 'group' })).rows;
    const openChat = rows.find((r) => r.name === 'Open group')!;
    const closedChat = rows.find((r) => r.name === 'Closed group')!;
    await linkHubspot(ws, ws, openChat.id, 'company', '9001');
    await linkHubspot(ws, ws, closedChat.id, 'company', '9001');
    const key = await createApiKey(ws, 'hubspot', w.member.id, ['groups:write']);
    const res = await sendRoute.POST(
      new Request('http://x.test/api/v1/groups/hubspot/send', {
        method: 'POST',
        body: JSON.stringify({ companyId: '9001', text: 'Renewal ready' }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key.key}` },
      }),
    );
    expect(res.status).toBe(201);
    const data = ((await res.json()) as { data: { sent: Array<{ chatId: string }>; skipped: number } }).data;
    expect(data.sent.map((s) => s.chatId)).toEqual([openChat.id]);
    expect(data.skipped).toBe(0);
    const out = (await getDb().prepare("SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ? AND direction = 'out'").get(closedChat.id)) as { n: number };
    expect(Number(out.n)).toBe(0);
  });
});
