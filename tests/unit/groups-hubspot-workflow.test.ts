import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { connectHubspot, linkHubspot } from '@/lib/groups-hubspot';
import { resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { fillTemplate, parseWorkflowBody } from '@/lib/groups-hubspot-workflow';
import { makeUser } from './helpers';

/** Lines: WhatsApp desde un workflow de HubSpot (POST /api/v1/groups/hubspot/send). Datos inventados. */

const route = await import('@/app/api/v1/groups/hubspot/send/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});

const ev = (chatId: string, id: string, name: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? name : undefined,
  fromMe: false,
  senderPhone: chatId.endsWith('@g.us') ? '5491100000009' : chatId.split('@')[0],
  senderName: name,
  providerMessageId: id,
  body: 'hola',
});

async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const n = await createNumber(owner.id, owner.id, { provider: 'fake', name: 'Ventas' });
  await connectNumber(owner.id, n.id);
  const st = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (st) st.connectedAt = Date.now() - 5000;
  const row = (await getNumberRowById(n.id))!;
  await ingestEvents(row, [ev(`1203632${label.length}@g.us`, `${label}-g`, 'Grupo Acme'), ev('5491155550199@c.us', `${label}-d`, 'Dana')]);
  await connectHubspot(owner.id, owner.id, 'pat-na1-fake-token-for-tests');
  const rows = (await listChats(owner.id, owner.id)).rows;
  return { owner, group: rows.find((r) => r.kind === 'group')!, dm: rows.find((r) => r.kind === 'dm')! };
}

const call = (key: string | null, body: unknown, query = '') =>
  route.POST(
    new Request(`http://x.test/api/v1/groups/hubspot/send${query}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    }),
  );

const outgoing = async (chatId: string) =>
  ((await getDb().prepare("SELECT body FROM groups_messages WHERE chat_id = ? AND direction = 'out' ORDER BY created_at").all(chatId)) as Array<{ body: string }>).map((m) => m.body);

describe('HubSpot workflow → WhatsApp: lectura', () => {
  it('entiende el cuerpo estándar de HubSpot, uno armado a mano y la URL', () => {
    const std = parseWorkflowBody({ objectId: 9001, objectType: 'COMPANY', properties: { name: { value: 'Acme' }, hs_object_id: '9001' } }, new URLSearchParams('text=Hola {{name}}&to=groups'));
    expect(std).toMatchObject({ objectType: 'company', objectId: '9001', text: 'Hola {{name}}', to: 'groups', properties: { name: 'Acme' } });
    const contact = parseWorkflowBody({ object: { objectId: '77', objectType: 'CONTACT', properties: { firstname: 'Dana', mobilephone: '+54 9 11 5555-0199' } }, fields: { text: 'Hola {{firstname}}' } }, new URLSearchParams());
    expect(contact).toMatchObject({ objectType: 'contact', objectId: '77', phone: '5491155550199', text: 'Hola {{firstname}}' });
    expect(parseWorkflowBody({ dealId: '8001', message: 'x', line: 'n1' }, new URLSearchParams())).toMatchObject({ objectType: 'deal', objectId: '8001', line: 'n1', to: 'all' });
    expect(parseWorkflowBody({ objectId: 'abc' }, new URLSearchParams())).toMatchObject({ objectId: '' });
    expect(fillTemplate('Hola {{ firstname }}, {{missing}}fin', { firstname: 'Dana' })).toBe('Hola Dana, fin');
  });
});

describe('HubSpot workflow → WhatsApp: manda', () => {
  it('al grupo vinculado a la empresa, con propiedades, sin duplicar en un reintento', async () => {
    const w = await world('hsw-a');
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9001');
    const key = await createApiKey(w.owner.id, 'hubspot');
    expect((await call(null, { companyId: '9001', text: 'x' })).status).toBe(401);
    const body = { callbackId: 'cb-1', objectId: 9001, objectType: 'COMPANY', properties: { name: 'Acme' } };
    const first = await call(key.key, body, '?text=' + encodeURIComponent('Hola {{name}}, tu renovación está lista'));
    expect(first.status).toBe(201);
    const data = ((await first.json()) as { data: { sent: Array<{ chatId: string; duplicate: boolean }> } }).data;
    expect(data.sent).toEqual([expect.objectContaining({ chatId: w.group.id, duplicate: false })]);
    expect(await outgoing(w.group.id)).toEqual(['Hola Acme, tu renovación está lista']);
    // HubSpot reintenta el mismo webhook: no sale otra vez.
    const retry = await call(key.key, body, '?text=' + encodeURIComponent('Hola {{name}}, tu renovación está lista'));
    expect(retry.status).toBe(200);
    expect(await outgoing(w.group.id)).toHaveLength(1);
    // Solo 1:1: el grupo no cuenta, y no hay otro chat vinculado.
    expect((await call(key.key, { companyId: '9001', text: 'x', to: 'dm' })).status).toBe(404);
  });

  it('al chat 1:1 por el teléfono del contacto, y nada para otro workspace', async () => {
    const w = await world('hsw-b');
    const other = await makeUser('hsw-b-other');
    const key = await createApiKey(w.owner.id, 'hubspot');
    const res = await call(key.key, { object: { objectId: 501, objectType: 'CONTACT', properties: { firstname: 'Dana', phone: '+54 9 11 5555-0199' } } }, '?text=Hola%20{{firstname}}');
    expect(res.status).toBe(201);
    expect(await outgoing(w.dm.id)).toEqual(['Hola Dana']);
    const foreign = await createApiKey(other.id, 'hubspot');
    expect((await call(foreign.key, { phone: '5491155550199', text: 'hola' })).status).toBe(404);
    expect((await call(key.key, { phone: '5491155550199' })).status).toBe(400);
    expect((await call(key.key, { text: 'hola' })).status).toBe(400);
    const readOnly = await createApiKey(w.owner.id, 'ro', w.owner.id, ['groups:read']);
    expect((await call(readOnly.key, { phone: '5491155550199', text: 'hola' })).status).toBe(403);
  });
});
