/**
 * Lines: color por línea (lib/line-colors.ts). Se guarda en la línea, se
 * valida contra la paleta y viaja con las líneas de un chat que está en varias
 * (para los puntos de la fila y "Responder desde"). Datos de demo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listNumbers, updateNumber } from '@/lib/groups';
import { LINE_COLORS, lineColor } from '@/lib/line-colors';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  return (await getNumberRowById(n.id))!;
}

const msg = (chatId: string, id: string): InboundEvent => ({
  type: 'message',
  chatId,
  isGroup: true,
  fromMe: false,
  senderPhone: '5491100009999',
  senderName: 'Contacto Demo',
  providerMessageId: id,
  body: 'hola',
  chatName: 'Grupo demo',
});

describe('color por línea', () => {
  it('solo acepta colores de la paleta', () => {
    expect(LINE_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(lineColor('blue')).toBe('blue');
    expect(lineColor('#ff0000')).toBe('');
    expect(lineColor(null)).toBe('');
  });

  it('se guarda, se quita y rechaza lo que no es de la paleta', async () => {
    const ws = (await makeUser('line-color')).id;
    const n = await line(ws, 'Ventas demo');
    expect((await listNumbers(ws)).find((x) => x.id === n.id)?.color).toBe('');
    expect((await updateNumber(ws, n.id, { color: 'teal' })).color).toBe('teal');
    expect((await listNumbers(ws)).find((x) => x.id === n.id)?.color).toBe('teal');
    // Cambiar el nombre no toca el color.
    expect((await updateNumber(ws, n.id, { name: 'Ventas demo 2' })).color).toBe('teal');
    await expect(updateNumber(ws, n.id, { color: 'url(x)' })).rejects.toMatchObject({ code: 'invalid_color' });
    expect((await updateNumber(ws, n.id, { color: '' })).color).toBe('');
    // Otro workspace no la encuentra.
    const other = (await makeUser('line-color-other')).id;
    await expect(updateNumber(other, n.id, { color: 'red' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('el chat en varias líneas trae el color de cada una', async () => {
    const ws = (await makeUser('line-color-same')).id;
    const ventas = await line(ws, 'Ventas demo');
    const soporte = await line(ws, 'Soporte demo');
    await updateNumber(ws, ventas.id, { color: 'blue' });
    await updateNumber(ws, soporte.id, { color: 'orange' });
    const jid = `1203${Date.now().toString(36)}@g.us`;
    await ingestEvents(ventas, [msg(jid, 'LC-1')]);
    await ingestEvents(soporte, [msg(jid, 'LC-1')]);
    const row = (await listChats(ws, ws, { cursor: '', limit: 50 })).rows.find((r) => r.kind === 'group')!;
    const byLine = Object.fromEntries((row.lines ?? []).map((l) => [l.lineId, l.color]));
    expect(byLine).toEqual({ [ventas.id]: 'blue', [soporte.id]: 'orange' });
  });
});
