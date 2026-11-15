import { describe, expect, it } from 'vitest';
import { editedText, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { middleEllipsis } from '@/components/groups/wa/format';

/**
 * Documentos con texto y su edición (Inbox y Lines, Evolution): el texto de
 * un documento se guarda, y editarlo cambia el texto en vez de borrarlo.
 * Datos inventados.
 */

const key = (id: string) => ({ remoteJid: '15550002222@s.whatsapp.net', fromMe: false, id });
const doc = { fileName: 'propuesta.html', mimetype: 'text/html', fileLength: 46_000, caption: 'te paso la primera versión' };

describe('documento con texto', () => {
  it('documentMessage.caption es el texto del mensaje', () => {
    const [ev] = parseEvolutionWebhook({ event: 'messages.upsert', data: { key: key('D1'), pushName: 'Eva', message: { documentMessage: doc } } });
    expect(ev).toMatchObject({ type: 'message', body: 'te paso la primera versión', media: { name: 'propuesta.html' } });
  });

  it('documentWithCaptionMessage (el envoltorio de WhatsApp) también', () => {
    const [ev] = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: { key: key('D2'), pushName: 'Eva', message: { documentWithCaptionMessage: { message: { documentMessage: doc } } } },
    });
    expect(ev).toMatchObject({ type: 'message', body: 'te paso la primera versión', media: { name: 'propuesta.html' } });
  });
});

describe('edición del texto de un archivo', () => {
  const edit = (editedMessage: Record<string, unknown>) =>
    parseEvolutionWebhook({ event: 'messages.upsert', data: { key: key('E9'), message: { protocolMessage: { type: 'MESSAGE_EDIT', key: { id: 'D1' }, editedMessage } } } });

  it('el pie nuevo de un documento, una foto o un video', () => {
    expect(edit({ documentMessage: { ...doc, caption: 'versión corregida' } })[0]).toMatchObject({ type: 'edit', providerMessageId: 'D1', body: 'versión corregida' });
    expect(edit({ documentWithCaptionMessage: { message: { documentMessage: { ...doc, caption: 'otra' } } } })[0]).toMatchObject({ type: 'edit', body: 'otra' });
    expect(edit({ imageMessage: { caption: 'la foto nueva' } })[0]).toMatchObject({ type: 'edit', body: 'la foto nueva' });
    expect(edit({ conversation: 'texto' })[0]).toMatchObject({ type: 'edit', body: 'texto' });
  });

  it('una edición sin texto legible no borra el que había', () => {
    expect(edit({ documentMessage: { fileName: 'x.html' } }).filter((e) => e.type === 'edit')).toEqual([]);
    expect(editedText({})).toBe('');
  });

  it('también cuando llega envuelta en editedMessage (historial)', () => {
    const evs = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: {
        key: key('E10'),
        message: { editedMessage: { message: { protocolMessage: { type: 'MESSAGE_EDIT', key: { id: 'D1' }, editedMessage: { documentMessage: { ...doc, caption: 'desde el historial' } } } } } },
      },
    });
    expect(evs[0]).toMatchObject({ type: 'edit', providerMessageId: 'D1', body: 'desde el historial' });
  });
});

describe('middleEllipsis', () => {
  it('corta en el medio y deja la extensión', () => {
    expect(middleEllipsis('corto.pdf')).toBe('corto.pdf');
    const long = middleEllipsis('propuesta-comercial-version-final-revisada-por-todos.html', 36);
    expect([...long].length).toBeLessThanOrEqual(36);
    expect(long.endsWith('todos.html')).toBe(true);
    expect(long).toContain('…');
  });
});
