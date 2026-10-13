import { describe, expect, it } from 'vitest';
import {
  createDocPage,
  getDocPage,
  listDocPages,
  moveDocPageStep,
  reorderDocPage,
  updateDocPage,
} from '@/lib/docs';
import { docPageUpdateSchema } from '@/lib/docs-schema';
import { emojiMatches } from '@/lib/emoji-names';
import { makeUser } from './helpers';

async function siblings(ownerId: string, parentId: string | null) {
  return (await listDocPages(ownerId)).filter((p) => p.parent_id === parentId).map((p) => p.title);
}

describe('Docs: orden manual del árbol', () => {
  it('reordena hermanas (antes/después) y Move up / Move down', async () => {
    const u = await makeUser('docs');
    const a = await createDocPage(u.id, { title: 'A' });
    const b = await createDocPage(u.id, { title: 'B' });
    const c = await createDocPage(u.id, { title: 'C' });

    expect(await reorderDocPage(u.id, a.id, c.id, 'after')).toBe(true);
    const order1 = await siblings(u.id, null);
    expect(order1.indexOf('A')).toBe(order1.indexOf('C') + 1);

    expect(await reorderDocPage(u.id, a.id, b.id, 'before')).toBe(true);
    const order2 = await siblings(u.id, null);
    expect(order2.indexOf('A')).toBe(order2.indexOf('B') - 1);

    const before = await siblings(u.id, null);
    expect(await moveDocPageStep(u.id, a.id, 1)).toBe(true);
    const after = await siblings(u.id, null);
    expect(after.indexOf('A')).toBe(before.indexOf('A') + 1);
    const first = (await listDocPages(u.id)).filter((p) => p.parent_id === null)[0];
    expect(await moveDocPageStep(u.id, first.id, -1)).toBe(false);
  });

  it('soltar junto a una página de otro nivel la vuelve hermana; no se puede meter en su propio subárbol', async () => {
    const u = await makeUser('docs2');
    const parent = await createDocPage(u.id, { title: 'Parent' });
    const child = await createDocPage(u.id, { title: 'Child', parent_id: parent.id });
    const root = await createDocPage(u.id, { title: 'Root' });

    expect(await reorderDocPage(u.id, root.id, child.id, 'after')).toBe(true);
    expect((await getDocPage(u.id, root.id))?.parent_id).toBe(parent.id);
    expect(await siblings(u.id, parent.id)).toEqual(['Child', 'Root']);

    expect(await reorderDocPage(u.id, parent.id, child.id, 'before')).toBe(false);
  });

  it('no toca páginas de otro usuario', async () => {
    const a = await makeUser('da');
    const b = await makeUser('db');
    const pa = await createDocPage(a.id, { title: 'mine' });
    const pb = await createDocPage(b.id, { title: 'theirs' });
    expect(await reorderDocPage(a.id, pa.id, pb.id, 'before')).toBe(false);
    expect(await reorderDocPage(b.id, pa.id, pb.id, 'before')).toBe(false);
    expect(await moveDocPageStep(b.id, pa.id, 1)).toBe(false);
  });
});

describe('Docs: ajustes de página persistidos', () => {
  it('guarda texto chico y ancho completo', async () => {
    const u = await makeUser('docs3');
    const p = await createDocPage(u.id, { title: 'Ajustes' });
    expect(p.small_text).toBe(false);
    expect(docPageUpdateSchema.safeParse({ small_text: true, full_width: true }).success).toBe(true);
    await updateDocPage(u.id, p.id, { small_text: true, full_width: true });
    const saved = await getDocPage(u.id, p.id);
    expect(saved?.small_text).toBe(true);
    expect(saved?.full_width).toBe(true);
    await updateDocPage(u.id, p.id, { small_text: false });
    expect((await getDocPage(u.id, p.id))?.small_text).toBe(false);
  });
});

describe('Docs: buscar emoji por nombre', () => {
  it.each([
    ['🚀', 'rocket'],
    ['🚀', 'cohete'],
    ['🚀', 'fogue'],
    ['🔥', 'fire'],
    ['📅', 'calend'],
    ['☕', 'cafe'],
  ])('%s coincide con "%s"', (emoji, q) => {
    expect(emojiMatches(emoji, q)).toBe(true);
  });

  it('no coincide con nombres ajenos y acepta el propio emoji', () => {
    expect(emojiMatches('🚀', 'pizza')).toBe(false);
    expect(emojiMatches('🍕', '🍕')).toBe(true);
    expect(emojiMatches('🍕', '')).toBe(true);
  });
});
