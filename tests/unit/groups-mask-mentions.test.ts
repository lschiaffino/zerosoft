/**
 * Lines: para quien no ve teléfonos, un mensaje no los trae en las
 * menciones (texto, lista de mencionados), en los avisos del grupo ni en la
 * cita de un mensaje de otro chat. Quien los ve recibe el mensaje igual.
 * Teléfonos de prueba (555), datos inventados.
 */
import { describe, expect, it } from 'vitest';
import { maskMessage, viewerFrom, DEFAULT_PLATFORM } from '@/lib/groups-access';
import type { MessageDto } from '@/lib/groups';

const A = '15550101777';
const B = '15550101888';

function message(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm1',
    chatId: 'c1',
    direction: 'in',
    body: `@${A} and @${B} please check`,
    senderPhone: B,
    senderName: '',
    reactions: [],
    meta: { mentions: [A, B] },
    mentionNames: { [A]: { name: 'Ana', phone: A } },
    replyToId: 'q1',
    replyQuote: { id: 'q1', chatId: 'c2', chatName: 'Group', direction: 'in', senderName: '', senderPhone: A, body: 'quoted', mediaType: '', deleted: false },
    ...over,
  } as unknown as MessageDto;
}

const masked = viewerFrom('w', 'p', 'member', { ...DEFAULT_PLATFORM, maskRoles: ['member'] });
const plain = viewerFrom('w', 'w', 'owner', { ...DEFAULT_PLATFORM, maskRoles: ['member'] });

describe('maskMessage: menciones, avisos y citas sin teléfonos', () => {
  it('quien no ve teléfonos: ninguno en el mensaje; la mención con nombre sigue con el nombre', () => {
    const out = maskMessage(masked, message());
    const json = JSON.stringify(out);
    expect(json).not.toContain(A);
    expect(json).not.toContain(B);
    expect(out.body.startsWith('@Ana and @+15 ••• 88')).toBe(true);
    expect((out.meta as Record<string, unknown>).mentions).toBeUndefined();
    expect(out.replyQuote?.senderPhone).not.toContain(A);
  });

  it('aviso del grupo: las personas sin nombre salen con el teléfono enmascarado', () => {
    const sys = { t: 'add', by: { p: A }, who: [{ p: B, n: 'Beto' }, { p: '123456789012345@lid' }, { p: 'me' }] };
    const out = maskMessage(masked, message({ direction: 'system' as MessageDto['direction'], body: '', meta: { sys } }));
    const shown = (out.meta as { sys: { by: { p: string; n: string }; who: Array<{ p: string; n?: string }> } }).sys;
    expect(JSON.stringify(shown)).not.toContain(A);
    expect(JSON.stringify(shown)).not.toContain(B);
    expect(shown.by.n).toMatch(/•••/);
    expect(shown.who[0].n).toBe('Beto');
    expect(shown.who[1]).toEqual({ p: '123456789012345@lid' });
    expect(shown.who[2]).toEqual({ p: 'me' });
  });

  it('quien ve teléfonos recibe el mensaje sin cambios', () => {
    const m = message();
    expect(maskMessage(plain, m)).toBe(m);
  });
});
