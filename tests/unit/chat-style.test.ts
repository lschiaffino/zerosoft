/** Estilo de chats (Inbox y Lines) por persona: WhatsApp por defecto, se guarda en el usuario. */
import { describe, expect, it } from 'vitest';
import { getChatStyle, isChatStyle, setChatStyle } from '@/lib/chat-style';
import { makeUser } from './helpers';

describe('estilo de chats', () => {
  it('WhatsApp por defecto, se cambia por persona y solo acepta los dos estilos', async () => {
    const a = await makeUser('chatstyle-a');
    const b = await makeUser('chatstyle-b');
    expect(await getChatStyle(a.id)).toBe('whatsapp');
    await setChatStyle(a.id, 'zerosoft');
    expect(await getChatStyle(a.id)).toBe('zerosoft');
    expect(await getChatStyle(b.id)).toBe('whatsapp');
    expect(isChatStyle('zerosoft')).toBe(true);
    expect(isChatStyle('dark')).toBe(false);
  });
});
