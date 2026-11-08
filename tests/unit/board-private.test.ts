import { describe, expect, it } from 'vitest';
import { cleanDrafts, draftsView, revealed } from '@/lib/board-private';
import { isPrivateDraft, privateDraftsOf, withoutPrivate } from '@/lib/board-canvas-tools';

const sticky = (id: string, author: string, priv = true) => ({
  id,
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 200,
  height: 150,
  version: 1,
  customData: { sticky: true, author, ...(priv ? { private: true } : {}) },
});
const label = (id: string, containerId: string, text: string) => ({ id, type: 'text', x: 0, y: 0, width: 10, height: 10, version: 1, containerId, text });

describe('real private mode', () => {
  const scene = [sticky('a', 'me'), label('ta', 'a', 'mi idea secreta'), sticky('b', 'other', false), label('tb', 'b', 'visible')];

  it('private drafts and their text never reach the saved or live scene', () => {
    expect(withoutPrivate(scene).map((e) => e.id)).toEqual(['b', 'tb']);
    expect(privateDraftsOf(scene, 'me').map((e) => e.id)).toEqual(['a', 'ta']);
    expect(privateDraftsOf(scene, 'other')).toEqual([]);
    expect(isPrivateDraft(sticky('a', 'me'))).toBe(true);
  });

  it('the server keeps only drafts of the author who sends them', () => {
    const forged = [sticky('x', 'someone-else'), label('tx', 'x', 'no'), ...scene.slice(0, 2)];
    expect(cleanDrafts(forged, 'me')!.map((e) => e.id)).toEqual(['a', 'ta']);
    expect(cleanDrafts([], 'me')).toEqual([]);
    expect(cleanDrafts('nope', 'me')).toBeNull();
  });

  it('others get only the boxes, never the text', () => {
    const view = draftsView(
      [
        { author: 'me', elements: scene.slice(0, 2) },
        { author: 'ana', elements: [sticky('c', 'ana'), label('tc', 'c', 'texto de ana')] },
      ],
      'me',
    );
    expect(view.mine.map((e) => e.id)).toEqual(['a', 'ta']);
    expect(view.others).toEqual([{ x: 10, y: 20, width: 200, height: 150 }]);
    expect(JSON.stringify(view.others)).not.toContain('texto de ana');
  });

  it('revealing drops the private mark and bumps the version so it wins the merge', () => {
    const r = revealed(sticky('a', 'me'));
    expect(r.customData).toEqual({ sticky: true, author: 'me' });
    expect(r.version).toBe(2);
  });
});
