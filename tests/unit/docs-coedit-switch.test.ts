import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createDocPage, getDocPageRow, parseBlocks, updateDocPage } from '@/lib/docs';
import { coeditEnabled, coeditEnvEnabled, getDocsSettings, updateDocsSettings } from '@/lib/docs-access';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

/**
 * Interruptor de la edición simultánea: el ajuste del workspace y la variable
 * DOCS_COEDIT. Apagada, Docs guarda y fusiona como antes: un guardado con
 * text_ops (editor viejo) lleva su texto y nada sale como operación.
 */

vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const para = (id: string, content: string): DocsBlock => ({ id, type: 'paragraph', content });
const textOf = async (pageId: string, id = 'p') => parseBlocks((await getDocPageRow(pageId))!.content).find((b) => b.id === id)?.content;
const opCount = async (pageId: string) =>
  Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM docs_live_events WHERE page_id = ? AND kind = 'op'").get(pageId)) as { n: number }).n);

afterEach(() => {
  delete process.env.DOCS_COEDIT;
});

describe('interruptor de la edición simultánea', () => {
  it('prendida por defecto; DOCS_COEDIT=off la apaga en toda la instancia', async () => {
    const owner = await makeUser('sw1');
    expect((await getDocsSettings(owner.id)).coedit).toBe(true);
    expect(await coeditEnabled(owner.id)).toBe(true);
    for (const v of ['off', '0', 'false', 'OFF']) {
      process.env.DOCS_COEDIT = v;
      expect(coeditEnvEnabled()).toBe(false);
      expect(await coeditEnabled(owner.id)).toBe(false);
    }
    process.env.DOCS_COEDIT = 'on';
    expect(await coeditEnabled(owner.id)).toBe(true);
  });

  it('apagada en el workspace: el guardado con text_ops lleva su texto y no publica operaciones', async () => {
    const owner = await makeUser('sw2');
    const page = await createDocPage(owner.id, { title: 'Sw' });
    await updateDocPage(owner.id, page.id, { content: [para('p', 'uno')] });
    await updateDocsSettings(owner.id, { coedit: false });
    expect(await coeditEnabled(owner.id)).toBe(false);
    const before = await opCount(page.id);
    await updateDocPage(owner.id, page.id, { content: [para('p', 'uno dos')], text_ops: true });
    expect(await textOf(page.id)).toBe('uno dos');
    expect(await opCount(page.id)).toBe(before);
    // Prendida otra vez: con text_ops el texto de un bloque existente viaja por operaciones.
    await updateDocsSettings(owner.id, { coedit: true });
    await updateDocPage(owner.id, page.id, { content: [para('p', 'otra cosa')], text_ops: true });
    expect(await textOf(page.id)).toBe('uno dos');
  });
});
