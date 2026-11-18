/**
 * Lines: lo que muestra la tabla de Ajustes › Números además del estado:
 * desde cuándo está en ese estado, el último mensaje y los chats abiertos.
 * Datos de demo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, disconnectNumber, getNumberRowById, ingestEvents, listChats, listNumbers, refreshNumber, updateChat } from '@/lib/groups';
import { numberStats } from '@/lib/groups-number-stats';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

const dm = (phone: string, id: string, timestamp: string): InboundEvent => ({
  type: 'message',
  chatId: `${phone}@c.us`,
  isGroup: false,
  fromMe: false,
  senderPhone: phone,
  senderName: 'Contacto Demo',
  providerMessageId: id,
  body: 'hola',
  timestamp,
});

const since = async (ws: string, id: string) => (await listNumbers(ws)).find((n) => n.id === id)!.statusSince;

describe('tabla de Números', () => {
  it('desde cuándo: se fija al crear y se mueve solo cuando cambia el estado', async () => {
    const ws = (await makeUser('nt-since')).id;
    const n = await createNumber(ws, ws, { provider: 'fake', name: 'Ventas demo' });
    expect(n.statusSince).toBeTruthy();
    // Un valor viejo conocido, para ver si se mueve o no.
    const old = '2026-01-01T00:00:00.000Z';
    await getDb().prepare('UPDATE groups_numbers SET status_since = ? WHERE id = ?').run(old, n.id);
    await connectNumber(ws, n.id);
    const connectedAt = await since(ws, n.id);
    expect(connectedAt).not.toBe(old);
    // pending → qr (el proveedor falso pide escanear).
    expect((await getNumberRowById(n.id))!.status).toBe('qr');
    // Volver a leer el mismo estado no lo mueve.
    await getDb().prepare('UPDATE groups_numbers SET status_since = ? WHERE id = ?').run(old, n.id);
    await refreshNumber(ws, n.id);
    expect(await since(ws, n.id)).toBe(old);
    // Desconectar sí.
    await disconnectNumber(ws, n.id);
    expect(await since(ws, n.id)).not.toBe(old);
  });

  it('último mensaje y chats abiertos por línea (sin cerrados, archivados ni eliminados)', async () => {
    const ws = (await makeUser('nt-stats')).id;
    const a = await createNumber(ws, ws, { provider: 'fake', name: 'Ventas demo' });
    await connectNumber(ws, a.id);
    const b = await createNumber(ws, ws, { provider: 'fake', name: 'Soporte demo' });
    await connectNumber(ws, b.id);
    const rowA = (await getNumberRowById(a.id))!;
    const base = Date.UTC(2026, 10, 18, 10, 0);
    const at = (min: number) => new Date(base + min * 60_000).toISOString();
    await ingestEvents(rowA, [dm('5491100000101', 'NT-1', at(1))]);
    await ingestEvents(rowA, [dm('5491100000102', 'NT-2', at(5))]);
    await ingestEvents(rowA, [dm('5491100000103', 'NT-3', at(3))]);
    const chats = (await listChats(ws, ws, { cursor: '', limit: 50 })).rows;
    expect(chats).toHaveLength(3);
    // Uno cerrado: no cuenta como abierto, pero su mensaje sigue siendo el último de la línea.
    await updateChat(ws, chats.find((c) => c.phone === '5491100000102')!.id, { status: 'closed' });

    const stats = await numberStats(ws);
    expect(stats.get(a.id)).toEqual({ lastMessageAt: at(5), openChats: 2 });
    // La línea sin chats no aparece (la tabla la muestra en cero).
    expect(stats.get(b.id)).toBeUndefined();
    // Otro workspace no ve nada de esta.
    expect((await numberStats((await makeUser('nt-other')).id)).get(a.id)).toBeUndefined();
  });
});
