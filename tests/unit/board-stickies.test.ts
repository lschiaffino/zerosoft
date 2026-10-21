import { describe, expect, it } from 'vitest';
import {
  STICKY_H,
  STICKY_PASTE_MAX,
  STICKY_W,
  cleanStickyTags,
  collectStickyTags,
  elementText,
  isSticky,
  layoutStickies,
  layoutStickiesInFreeSpace,
  parseBulkStickies,
  selectionItems,
  stickiesWithTag,
  stickyFill,
  stickyIssueTitle,
  stickySkeleton,
  stickyTags,
  withFill,
  withStickyTags,
  type SceneEl,
} from '@/lib/board-stickies';
import { excalidrawLang, formatCountdown } from '@/lib/board-view';

const sticky = (id: string, text: string, tags?: string[]): SceneEl[] => [
  {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    version: 3,
    boundElements: [{ id: `${id}-t`, type: 'text' }],
    customData: tags ? { sticky: true, tags } : null,
  },
  { id: `${id}-t`, type: 'text', text, originalText: text, containerId: id },
];

describe('board-stickies: pegado en bloque', () => {
  it('una línea = un sticky, sin viñetas, con #tags y tags comunes', () => {
    const drafts = parseBulkStickies('- Arreglar login #bug #Safari\n\n2. Onboarding más corto\n[ ] Nota\tcon tab', ['retro']);
    expect(drafts).toEqual([
      { text: 'Arreglar login', tags: ['retro', 'bug', 'safari'] },
      { text: 'Onboarding más corto', tags: ['retro'] },
      { text: 'Nota · con tab', tags: ['retro'] },
    ]);
  });

  it('ignora líneas vacías o solo con tags y respeta el tope', () => {
    expect(parseBulkStickies('#solo\n   \n')).toEqual([]);
    const many = Array.from({ length: STICKY_PASTE_MAX + 20 }, (_, i) => `idea ${i}`).join('\n');
    expect(parseBulkStickies(many)).toHaveLength(STICKY_PASTE_MAX);
  });

  it('tags limpios, sin repetir y con tope', () => {
    expect(cleanStickyTags(['#UX', 'ux', 'Big Idea', ''])).toEqual(['ux', 'big-idea']);
    expect(cleanStickyTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(8);
  });
});

describe('board-stickies: grilla y esqueletos', () => {
  it('la grilla queda centrada y sin superposiciones', () => {
    expect(layoutStickies(0, { x: 0, y: 0 })).toEqual([]);
    const one = layoutStickies(1, { x: 500, y: 400 });
    expect(one).toEqual([{ x: 500 - STICKY_W / 2, y: 400 - STICKY_H / 2 }]);
    const nine = layoutStickies(9, { x: 0, y: 0 });
    const keys = new Set(nine.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(9);
    expect(new Set(nine.map((p) => p.x)).size).toBe(3);
    expect(layoutStickies(40, { x: 0, y: 0 }).every((p, _, all) => new Set(all.map((q) => q.x)).size <= 6)).toBe(true);
  });

  it('el esqueleto lleva color, texto y customData', () => {
    const sk = stickySkeleton({ text: 'Hola', tags: ['ux'] }, { x: 1, y: 2 }, stickyFill('blue'));
    expect(sk).toMatchObject({
      type: 'rectangle',
      x: 1,
      y: 2,
      backgroundColor: '#a5d8ff',
      label: { text: 'Hola' },
      customData: { sticky: true, tags: ['ux'] },
    });
    expect(stickyFill('nope')).toBe('#ffec99');
  });
});

describe('board-stickies: tags, color y selección', () => {
  const scene = [...sticky('a', 'Uno', ['ux']), ...sticky('b', 'Dos', ['ux', 'bug']), ...sticky('c', 'Plantilla'), { id: 'free', type: 'text', text: 'Suelto' }];

  it('reconoce stickies (también los de plantilla) y junta sus tags', () => {
    expect(isSticky(scene[0])).toBe(true);
    expect(isSticky(scene[4])).toBe(true);
    expect(isSticky(scene[1])).toBe(false);
    expect(collectStickyTags(scene)).toEqual([
      { tag: 'ux', count: 2 },
      { tag: 'bug', count: 1 },
    ]);
    expect(stickiesWithTag(scene, 'bug')).toEqual(['b']);
  });

  it('cambiar tags o color sube la versión (así se guarda y se combina)', () => {
    const tagged = withStickyTags(scene[4], ['Nuevo'], 7);
    expect(stickyTags(tagged)).toEqual(['nuevo']);
    expect(tagged.version).toBe(4);
    expect(tagged.versionNonce).toBe(7);
    const painted = withFill(scene[0], '#b2f2bb', 9);
    expect(painted).toMatchObject({ backgroundColor: '#b2f2bb', version: 4, versionNonce: 9 });
  });

  it('la selección se resuelve a tarjetas con texto (el texto ligado cuenta como su forma)', () => {
    const items = selectionItems(scene, { 'a-t': true, a: true, free: true, c: true, nope: true, b: false });
    expect(items).toEqual([
      { elementId: 'a', text: 'Uno' },
      { elementId: 'free', text: 'Suelto' },
      { elementId: 'c', text: 'Plantilla' },
    ]);
    const byId = new Map(scene.map((e) => [e.id, e]));
    expect(elementText(scene[2], byId)).toBe('Dos');
  });

  it('título de issue: primera línea, sin saltos, con tope', () => {
    expect(stickyIssueTitle('\n  Arreglar   login \nDetalle')).toBe('Arreglar login');
    expect(stickyIssueTitle('x'.repeat(250))).toHaveLength(200);
  });
});

describe('board-view: cuenta regresiva', () => {
  it('formatea minutos, horas y redondea para arriba', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(3_723_000)).toBe('1:02:03');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('board-stickies: pegado en un hueco libre', () => {
  const box = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, width: STICKY_W, height: STICKY_H });
  const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>, margin = 0) =>
    a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;

  it('con el lienzo vacío queda centrada como siempre', () => {
    expect(layoutStickiesInFreeSpace(4, { x: 0, y: 0 }, [])).toEqual(layoutStickies(4, { x: 0, y: 0 }));
  });

  it('no pisa un sticky que ya está en el centro de la vista', () => {
    const existing = { x: -100, y: -75, width: STICKY_W, height: STICKY_H };
    const placed = layoutStickiesInFreeSpace(4, { x: 0, y: 0 }, [existing]).map(box);
    expect(placed).toHaveLength(4);
    // Ni encima ni pegado: queda lugar para la línea de tags de arriba.
    expect(placed.some((b) => hit(b, existing, 24))).toBe(false);
    // Cerca del centro (no se va al fin del lienzo).
    expect(Math.abs(placed[0].x) + Math.abs(placed[0].y)).toBeLessThan(2000);
  });

  it('entre filas entra la línea de tags (insignias de ~22px arriba de cada sticky)', () => {
    const rows = [...new Set(layoutStickies(6, { x: 0, y: 0 }).map((p) => p.y))].sort((a, b) => a - b);
    expect(rows).toHaveLength(2);
    expect(rows[1] - (rows[0] + STICKY_H)).toBeGreaterThanOrEqual(48);
  });

  it('si todo alrededor está ocupado, va debajo de lo que hay', () => {
    const wall = { x: -50_000, y: -50_000, width: 100_000, height: 100_000 };
    const placed = layoutStickiesInFreeSpace(2, { x: 0, y: 0 }, [wall]);
    expect(placed.every((p) => p.y > wall.y + wall.height)).toBe(true);
  });
});

describe('board-view: idioma de Excalidraw', () => {
  it('sigue al locale de la app', () => {
    expect(excalidrawLang('es')).toBe('es-ES');
    expect(excalidrawLang('pt')).toBe('pt-BR');
    expect(excalidrawLang('en')).toBe('en');
    expect(excalidrawLang('es-AR')).toBe('es-ES');
    expect(excalidrawLang('fr')).toBe('en');
  });
});
