/**
 * Lines: "Bloquear a X" en la info de un chat 1:1 y en la ficha de una persona
 * de un grupo. Va por el adaptador de la línea (el falso anota 'block'), queda
 * guardado en el chat y la ficha lo muestra. Números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { setChatBlocked } from '@/lib/groups-block';
import { personCard } from '@/lib/groups-person';
import { startChat } from '@/lib/groups-new-chat';
import { systemViewer } from '@/lib/groups-access';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ME = '15550000091';
const ANA = '5491177730011';

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (fake) fake.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(ME, n.id);
  return { user, row: (await getNumberRowById(n.id))! };
}

const groupMsg = (): InboundEvent =>
  ({
    type: 'message',
    chatId: '120363000000000901@g.us',
    isGroup: true,
    chatName: 'Compras',
    fromMe: false,
    senderPhone: ANA,
    senderName: 'Ana Prueba',
    providerMessageId: `b-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
  }) as InboundEvent;

describe('Lines: bloquear contacto', () => {
  it('bloquea y desbloquea en WhatsApp por el adaptador, y la info y la ficha lo muestran', async () => {
    const { user, row } = await setup('lines-block');
    await ingestEvents(row, [groupMsg()]);
    const group = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Compras')!;
    const viewer = systemViewer(user.id);
    const dm = await startChat(viewer, { numberId: row.id, phone: ANA });

    let chat = await getChat(user.id, dm.id);
    expect(chat).toMatchObject({ canBlock: true });
    expect(chat?.blocked).toBeUndefined();
    expect(await personCard(viewer, group.id, ANA)).toMatchObject({ canBlock: true, dm: { id: dm.id, blocked: false } });

    chat = await setChatBlocked(user.id, dm.id, true);
    expect(chat.blocked).toBe(true);
    const sent = fakeSent(row.id).filter((s) => s.kind === 'block');
    expect(sent.at(-1)).toMatchObject({ text: 'block' });
    expect((await personCard(viewer, group.id, ANA)).dm?.blocked).toBe(true);

    chat = await setChatBlocked(user.id, dm.id, false);
    expect(chat.blocked).toBeUndefined();
    expect(fakeSent(row.id).filter((s) => s.kind === 'block').at(-1)).toMatchObject({ text: 'unblock' });
    expect((await personCard(viewer, group.id, ANA)).dm?.blocked).toBe(false);
  });

  it('un grupo no se bloquea, ni con la línea desconectada, ni el chat de otro workspace', async () => {
    const { user, row } = await setup('lines-block-no');
    await ingestEvents(row, [groupMsg()]);
    const group = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Compras')!;
    await expect(setChatBlocked(user.id, group.id, true)).rejects.toMatchObject({ code: 'unsupported' });

    const dm = await startChat(systemViewer(user.id), { numberId: row.id, phone: ANA });
    const other = await makeUser('lines-block-other');
    await expect(setChatBlocked(other.id, dm.id, true)).rejects.toMatchObject({ code: 'not_found' });

    await getDb().prepare("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?").run(row.id);
    await expect(setChatBlocked(user.id, dm.id, true)).rejects.toMatchObject({ code: 'not_connected' });
    expect((await getChat(user.id, dm.id))?.canBlock).toBeUndefined();
    expect(fakeSent(row.id).filter((s) => s.kind === 'block')).toEqual([]);
  });
});
