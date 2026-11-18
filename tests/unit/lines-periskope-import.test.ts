import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, createPropertyDef, getNumberRowById, ingestEvents, listChats, listLabels, listQuickReplies } from '@/lib/groups';
import { importPeriskope, labelColorFrom, mapHeader, splitList } from '@/lib/groups-periskope';
import { listAudit } from '@/lib/groups-audit';
import { makeUser } from './helpers';

/** Lines › Ajustes › Migrar de Periskope (lib/groups-periskope.ts). Datos inventados. */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function line(ws: string, name: string, phone: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET phone = ?, status = 'connected' WHERE id = ?").run(phone, n.id);
  return (await getNumberRowById(n.id))!;
}

async function createTeamFor(ownerId: string): Promise<string> {
  const db = getDb();
  const team = (await db.prepare('SELECT id FROM teams WHERE owner_id = ?').get(ownerId)) as { id: string } | undefined;
  if (team) return team.id;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(id, 'T', ownerId);
  return id;
}

const inbound = (chatId: string, id: string, body: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? 'Grupo de prueba' : undefined,
  fromMe: false,
  senderPhone: '5490000000900',
  senderName: 'Persona de prueba',
  providerMessageId: id,
  body,
});

describe('importar desde Periskope: lectura', () => {
  it('lee encabezados con alias, colores y listas', () => {
    const { cols, extra } = mapHeader(['Chat ID', 'Chat Name', 'Chat Type', 'Org Phone', 'Labels', 'Assigned To', 'Plan'], ['chatId', 'chatName', 'chatType', 'orgPhone', 'labels', 'assignee']);
    expect(cols).toEqual({ chatId: 0, chatName: 1, chatType: 2, orgPhone: 3, labels: 4, assignee: 5 });
    expect(extra.map((e) => e.name)).toEqual(['Plan']);
    expect(splitList('VIP, Soporte;VIP | Ventas')).toEqual(['VIP', 'Soporte', 'Ventas']);
    expect(labelColorFrom('#eb5757')).toBe('red');
    expect(labelColorFrom('#2f80ed')).toBe('blue');
    expect(labelColorFrom('green')).toBe('green');
    expect(labelColorFrom('#777777')).toBe('gray');
    expect(labelColorFrom('')).toBe('gray');
  });
});

describe('importar desde Periskope: escribe', () => {
  it('etiquetas y respuestas rápidas, con vista previa que no escribe', async () => {
    const user = await makeUser('psk-labels');
    const csv = 'Name,Color\nVIP,#eb5757\nSoporte,#2f80ed\n,#000000\n';
    const preview = await importPeriskope(user.id, user.id, 'labels', csv, { dryRun: true });
    expect(preview).toMatchObject({ dryRun: true, rows: 3, applied: 2, created: { labels: 2 } });
    expect(preview.issues.map((i) => i.reason)).toEqual(['empty_name']);
    expect(await listLabels(user.id)).toHaveLength(0);
    await importPeriskope(user.id, user.id, 'labels', csv);
    expect((await listLabels(user.id)).map((l) => [l.name, l.color]).sort()).toEqual([['Soporte', 'blue'], ['VIP', 'red']]);
    // Otra vez: ya existen, no se duplican.
    const again = await importPeriskope(user.id, user.id, 'labels', csv);
    expect(again.applied).toBe(0);

    const qr = await importPeriskope(user.id, user.id, 'quick_replies', 'Command,Message\n/hola,"Hola, ¿cómo estás?"\n/hola,repetida\n,sin comando\n/vacio,\n');
    expect(qr.applied).toBe(1);
    expect(qr.issues.map((i) => i.reason)).toEqual(['exists', 'invalid_shortcut', 'empty_message']);
    expect(await listQuickReplies(user.id)).toEqual([expect.objectContaining({ shortcut: 'hola', body: 'Hola, ¿cómo estás?' })]);
    expect((await listAudit(user.id, { action: 'imported' })).length).toBe(2);
  });

  it('chats y contactos: etiquetas, asignado y propiedades sobre los chats que ya están en Lines', async () => {
    const user = await makeUser('psk-chats');
    const eva = await makeUser('psk-chats-eva');
    await addMember(await createTeamFor(user.id), eva.id, 'member');
    const evaEmail = ((await getDb().prepare('SELECT email FROM users WHERE id = ?').get(eva.id)) as { email: string }).email;
    await createPropertyDef(user.id, { label: 'Plan', type: 'text' });
    const a = await line(user.id, 'Ventas', '5490000000001');
    await ingestEvents(a, [inbound('120363000000777@g.us', 'PSK-1', 'hola'), inbound('5490000000701@c.us', 'PSK-2', 'hola')]);

    const chatsCsv = [
      'Chat ID,Chat Name,Chat Type,Org Phone,Labels,Assigned To,Plan,Otra',
      `120363000000777@g.us,Grupo,group,+549 0000 000 001,"VIP, Nueva",${evaEmail},Pro,x`,
      '5490000000701@c.us,Uno,user,5490000000001,Soporte,,Basic,',
      '999@g.us,No existe,group,,,,,',
      '5490000000701@c.us,Uno,user,5490000099999,,,,',
      'sin-numero,Nadie,user,,,,,',
    ].join('\n');
    const preview = await importPeriskope(user.id, user.id, 'chats', chatsCsv, { dryRun: true });
    expect(preview.applied).toBe(2);
    expect((await listChats(user.id, user.id)).rows.every((c) => c.labels.length === 0)).toBe(true);

    const res = await importPeriskope(user.id, user.id, 'chats', chatsCsv);
    expect(res.applied).toBe(2);
    expect(res.issues.map((i) => i.reason).sort()).toEqual(['chat_not_found', 'invalid_phone', 'unknown_line']);
    expect(res.ignoredColumns).toEqual(['Otra']);
    const rows = (await listChats(user.id, user.id)).rows;
    const g = rows.find((c) => c.kind === 'group')!;
    expect(g.labels.map((l) => l.name).sort()).toEqual(['Nueva', 'VIP']);
    expect(g.assignedTo).toBe(eva.id);
    expect(g.properties).toMatchObject({ plan: 'Pro' });
    const dm = rows.find((c) => c.kind === 'dm')!;
    expect(dm.labels.map((l) => l.name)).toEqual(['Soporte']);

    const contacts = await importPeriskope(user.id, user.id, 'contacts', 'Phone,Name,Labels\n+549 0000 000 701,Uno,VIP\n123,Nadie,\n');
    expect(contacts.applied).toBe(1);
    expect(contacts.issues.map((i) => i.reason)).toEqual(['invalid_phone']);
    expect((await listChats(user.id, user.id)).rows.find((c) => c.kind === 'dm')!.labels.map((l) => l.name).sort()).toEqual(['Soporte', 'VIP']);

    const missing = await importPeriskope(user.id, user.id, 'chats', 'Foo,Bar\n1,2\n');
    expect(missing.issues[0].reason).toBe('missing_column:chatId');
  });

  it('no cruza a otro workspace y corta archivos grandes', async () => {
    const owner = await makeUser('psk-ws-a');
    const other = await makeUser('psk-ws-b');
    const a = await line(owner.id, 'A', '5490000000011');
    await ingestEvents(a, [inbound('5490000000811@c.us', 'PSK-X', 'hola')]);
    const res = await importPeriskope(other.id, other.id, 'contacts', 'Phone,Labels\n5490000000811,VIP\n');
    expect(res.applied).toBe(0);
    expect(res.issues.map((i) => i.reason)).toEqual(['chat_not_found']);
    expect((await listChats(owner.id, owner.id)).rows[0].labels).toEqual([]);
    await expect(importPeriskope(owner.id, owner.id, 'labels', `Name\n${'x'.repeat(4 * 1024 * 1024 + 10)}\n`)).rejects.toThrow('file_too_large');
  });
});
