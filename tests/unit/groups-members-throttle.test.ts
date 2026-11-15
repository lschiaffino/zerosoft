import { describe, expect, it } from 'vitest';
import { MEMBERS_RETRY_SEC, membersFetchAllowed } from '@/lib/groups';

// Un grupo sin miembros conocidos pedía sus miembros a WhatsApp en cada mensaje (groupMetadata → 429).
describe('miembros de un grupo desconocido: como mucho un pedido por ventana', () => {
  it('deja el primero y frena los siguientes del mismo chat', async () => {
    const chat = `chat-${crypto.randomUUID()}`;
    expect(await membersFetchAllowed(chat)).toBe(true);
    expect(await membersFetchAllowed(chat)).toBe(false);
    expect(await membersFetchAllowed(chat)).toBe(false);
  });

  it('cada chat tiene su propio tope', async () => {
    const a = `chat-${crypto.randomUUID()}`;
    const b = `chat-${crypto.randomUUID()}`;
    expect(await membersFetchAllowed(a)).toBe(true);
    expect(await membersFetchAllowed(b)).toBe(true);
  });

  it('la ventana es de horas, no de segundos', () => {
    expect(MEMBERS_RETRY_SEC).toBeGreaterThanOrEqual(3600);
  });
});
