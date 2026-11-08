import { describe, expect, it } from 'vitest';
import {
  bulletEdit,
  contentBounds,
  elementAt,
  fileCardSkeleton,
  fileKind,
  formatBytes,
  freeSpot,
  isBoardFileLink,
  hiddenInPrivate,
  isStickyLike,
  stickyAuthor,
  withAuthor,
  minimapLayout,
  minimapToScene,
  nextStickyBox,
  editTable,
  selectedTable,
  tableShape,
  parseCsvRows,
  parseSpreadsheetPaste,
  parseStickyCsv,
  pinPosition,
  reactionsOf,
  tableSkeletons,
  toggleReaction,
} from '@/lib/board-canvas-tools';
import { buildTemplateScene, isBoardTemplate } from '@/lib/board-templates';
import { stickiesToCsv } from '@/lib/board-stickies';
import { attachmentExtension, cleanAttachmentName } from '@/lib/board-file-refs';

const box = (x: number, y: number, width = 200, height = 150) => ({ x, y, width, height });

describe('nextStickyBox', () => {
  it('places the next sticky beside the current one in the given direction', () => {
    expect(nextStickyBox(box(0, 0), 'right', [])).toEqual(box(224, 0));
    expect(nextStickyBox(box(0, 0), 'down', [])).toEqual(box(0, 174));
    expect(nextStickyBox(box(0, 0), 'left', [])).toEqual(box(-224, 0));
    expect(nextStickyBox(box(0, 0), 'up', [])).toEqual(box(0, -174));
  });
  it('skips over occupied spots in the same direction', () => {
    expect(nextStickyBox(box(0, 0), 'right', [box(224, 0)])).toEqual(box(448, 0));
  });
});

describe('file cards', () => {
  it('shows icon, name, kind and size, links the file and keeps its data', () => {
    const card = fileCardSkeleton({ fileId: 'att_1', url: '/api/boards/b1/files/att_1', name: 'Contrato final.pdf', mime: 'application/pdf', size: 1258291 }, { x: 0, y: 0 });
    expect((card.label as { text: string }).text).toBe('📕 Contrato final.pdf\nPDF · 1.2 MB');
    expect(card.link).toBe('/api/boards/b1/files/att_1');
    expect((card.customData as { file: { fileId: string } }).file.fileId).toBe('att_1');
    expect(fileKind('plan.xlsx').label).toBe('XLS');
    expect(fileKind('raro.bin').icon).toBe('📎');
    expect(formatBytes(820)).toBe('820 B');
    expect(isBoardFileLink('/api/boards/b1/files/att_1')).toBe(true);
    expect(isBoardFileLink('https://evil.test/api/boards/b1/files/x')).toBe(false);
  });
  it('attachment names are cleaned and only allowed extensions pass', () => {
    expect(cleanAttachmentName('C:\\tmp\\a"b.pdf')).toBe('ab.pdf');
    expect(attachmentExtension('x.PDF')).toBe('pdf');
    expect(attachmentExtension('x.exe')).toBeNull();
    expect(attachmentExtension('x.html')).toBeNull();
  });
});

describe('bullets while typing', () => {
  it('turns "- " into a bullet, continues the list on Enter and ends it on an empty bullet', () => {
    expect(bulletEdit('Ideas\n-', 7, 7, ' ', false)).toEqual({ value: 'Ideas\n• ', caret: 8 });
    expect(bulletEdit('• uno', 5, 5, 'Enter', false)).toEqual({ value: '• uno\n• ', caret: 8 });
    expect(bulletEdit('• uno\n• ', 8, 8, 'Enter', false)).toEqual({ value: '• uno\n', caret: 6 });
    expect(bulletEdit('texto', 5, 5, 'Enter', false)).toBeNull();
    expect(bulletEdit('a-', 2, 2, ' ', false)).toBeNull();
    expect(bulletEdit('• uno', 5, 5, 'Enter', true)).toBeNull();
  });
});

describe('freeSpot', () => {
  it('uses the center when free and moves off occupied areas', () => {
    expect(freeSpot({ width: 100, height: 100 }, { x: 0, y: 0 }, [])).toEqual({ x: -50, y: -50 });
    const p = freeSpot({ width: 100, height: 100 }, { x: 0, y: 0 }, [box(-60, -60, 120, 120)]);
    expect(p.x + 100 <= -60 - 32 || p.x >= 60 + 32 || p.y + 100 <= -60 - 32 || p.y >= 60 + 32).toBe(true);
  });
});

describe('reactions', () => {
  const el = { id: 'a', type: 'rectangle', version: 3 };
  it('toggles a person in and out and bumps the version', () => {
    const on = toggleReaction(el, '👍', 'u1', 7);
    expect(reactionsOf(on)).toEqual({ '👍': ['u1'] });
    expect(on.version).toBe(4);
    expect((on as { versionNonce?: number }).versionNonce).toBe(7);
    const two = toggleReaction(on, '👍', 'u2');
    expect(reactionsOf(two)['👍']).toEqual(['u1', 'u2']);
    const off = toggleReaction(toggleReaction(two, '👍', 'u1'), '👍', 'u2');
    expect(reactionsOf(off)).toEqual({});
  });
  it('ignores unknown emoji and junk from the scene', () => {
    expect(reactionsOf({ id: 'x', customData: { reactions: { '💩': ['u'], '👍': [1, 'u', 'u'] } } })).toEqual({ '👍': ['u'] });
    expect(reactionsOf({ id: 'x', customData: { reactions: 'nope' } })).toEqual({});
  });
  it('keeps the sticky data when reacting', () => {
    const sticky = { id: 's', customData: { sticky: true, tags: ['ux'] } };
    expect(toggleReaction(sticky, '🎉', 'u').customData).toMatchObject({ sticky: true, tags: ['ux'] });
  });
});

describe('private mode', () => {
  const mine = { id: '1', customData: { sticky: true, author: 'me' } };
  const theirs = { id: '2', customData: { sticky: true, author: 'other' } };
  const template = { id: '3', customData: { sticky: true } };
  it('hides every sticky-like element not written by me, and only while it is on', () => {
    expect(hiddenInPrivate(mine, 'me', true)).toBe(false);
    expect(hiddenInPrivate(theirs, 'me', true)).toBe(true);
    expect(hiddenInPrivate(template, 'me', true)).toBe(true);
    expect(hiddenInPrivate(theirs, 'me', false)).toBe(false);
  });
  it('treats template notes (palette fill + text) as stickies, not plain shapes', () => {
    const note = { id: 'n', type: 'rectangle', backgroundColor: '#FFEC99', boundElements: [{ id: 't', type: 'text' }] };
    const column = { id: 'c', type: 'rectangle', backgroundColor: '#ebfbee', boundElements: null };
    const flow = { id: 'f', type: 'ellipse', backgroundColor: '#b2f2bb', boundElements: [{ id: 't', type: 'text' }] };
    expect(isStickyLike(note)).toBe(true);
    expect(isStickyLike(column)).toBe(false);
    expect(isStickyLike(flow)).toBe(false);
    expect(hiddenInPrivate(column, 'me', true)).toBe(false);
    expect(stickyAuthor(withAuthor(note, 'me'))).toBe('me');
  });
});

describe('minimap', () => {
  it('fits content and viewport, and maps clicks back to the scene', () => {
    const layout = minimapLayout(box(0, 0, 1000, 500), box(0, 0, 500, 250), { width: 216, height: 116 }, 8);
    expect(layout.scale).toBeCloseTo(0.2);
    expect(layout.viewport.width).toBeCloseTo(100);
    const p = minimapToScene({ x: layout.offsetX + 100, y: layout.offsetY + 50 }, layout);
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(250);
  });
  it('keeps the viewport inside even when looking away from the content', () => {
    const layout = minimapLayout(box(0, 0, 100, 100), box(5000, 0, 500, 300), { width: 200, height: 120 });
    expect(layout.viewport.x + layout.viewport.width).toBeLessThanOrEqual(200);
  });
  it('bounds ignore deleted elements and bound text', () => {
    expect(contentBounds([{ id: 'a', x: 10, y: 10, width: 10, height: 10 }, { id: 'b', x: 900, y: 900, width: 1, height: 1, isDeleted: true }, { id: 't', x: -500, y: 0, width: 1, height: 1, containerId: 'a' }])).toEqual(box(10, 10, 10, 10));
    expect(contentBounds([])).toBeNull();
  });
});

describe('table', () => {
  it('builds a grouped grid with a header row, capped in size', () => {
    const cells = tableSkeletons(3, 4, { x: 0, y: 0 }, 'g1', [['A', 'B']]);
    expect(cells).toHaveLength(12);
    expect(new Set(cells.map((c) => (c.groupIds as string[])[0]))).toEqual(new Set(['g1']));
    expect((cells[0].label as { text: string }).text).toBe('A');
    expect(cells[0].backgroundColor).not.toBe(cells[4].backgroundColor);
    expect(tableSkeletons(99, 99, { x: 0, y: 0 }, 'g')).toHaveLength(144);
  });
  it('adds and removes rows and columns, shifting cells and their text', () => {
    // 2×2 de 100×50 con texto en cada celda.
    const els: Array<Record<string, unknown> & { id: string }> = [];
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++) {
        const id = `c${r}${c}`;
        els.push({ id, type: 'rectangle', x: c * 100, y: r * 50, width: 100, height: 50, version: 1, groupIds: ['g'], boundElements: [{ id: `t${r}${c}`, type: 'text' }], customData: { table: 'g', row: r, col: c } });
        els.push({ id: `t${r}${c}`, type: 'text', x: c * 100 + 10, y: r * 50 + 10, width: 20, height: 20, version: 1, containerId: id });
      }
    const pick = selectedTable(els, ['t11']);
    expect(pick).toEqual({ tableId: 'g', cell: { row: 1, col: 1 } });
    expect(selectedTable(els, ['c00', 'c01'])?.cell).toBeNull();
    const addRow = editTable(els, 'g', { kind: 'addRow', after: 0 })!;
    expect(addRow.added).toHaveLength(2);
    expect(addRow.added[0]).toMatchObject({ y: 50, x: 0, customData: { row: 1, col: 0 } });
    const moved = addRow.updated.find((e) => e.id === 'c10')!;
    expect(moved).toMatchObject({ y: 100, customData: { row: 2 } });
    expect(addRow.updated.find((e) => e.id === 't10')!.y).toBe(110);
    const addCol = editTable(els, 'g', { kind: 'addCol', after: 1 })!;
    expect(addCol.added.map((a) => a.x)).toEqual([200, 200]);
    const delCol = editTable(els, 'g', { kind: 'removeCol', index: 0 })!;
    expect(delCol.removed.sort()).toEqual(['c00', 'c10', 't00', 't10']);
    expect(delCol.updated.find((e) => e.id === 'c01')).toMatchObject({ x: 0, customData: { col: 0 } });
    expect(editTable(els.filter((e) => String(e.id).endsWith('0') || e.id === 'c00'), 'g', { kind: 'removeCol', index: 0 })).toBeNull();
    expect(tableShape(els, 'g')).toMatchObject({ rows: 2, cols: 2 });
  });
  it('turns a spreadsheet paste into rows and cells, and ignores plain text', () => {
    expect(parseSpreadsheetPaste('Name\tScore\r\nAna\t3\nLeo\t5\n')).toEqual([['Name', 'Score'], ['Ana', '3'], ['Leo', '5']]);
    expect(parseSpreadsheetPaste('just a line')).toBeNull();
    expect(parseSpreadsheetPaste('a\tb')).toBeNull();
  });
});

describe('sticky CSV import', () => {
  it('reads our own export back (text, tags, color, position), formulas unguarded', () => {
    const csv = stickiesToCsv([
      { id: 's1', type: 'rectangle', x: 10, y: 20, width: 200, height: 150, backgroundColor: '#b2f2bb', customData: { sticky: true, tags: ['ux', 'q3'] }, boundElements: [{ id: 't1', type: 'text' }] },
      { id: 't1', type: 'text', text: '=SUM, "quoted"', originalText: '=SUM, "quoted"', containerId: 's1' },
    ]);
    const [s] = parseStickyCsv(csv);
    expect(s).toEqual({ text: '=SUM, "quoted"', tags: ['ux', 'q3'], fill: '#b2f2bb', x: 10, y: 20 });
  });
  it('reads a Miro sticky export (one content column, no header)', () => {
    const out = parseStickyCsv('"Faster onboarding"\n"Fix export\non Safari"\n\n');
    expect(out.map((s) => s.text)).toEqual(['Faster onboarding', 'Fix export\non Safari']);
    expect(out[0].fill).toBeNull();
  });
  it('accepts semicolons and Miro color names', () => {
    expect(parseStickyCsv('Content;Color\nIdea;light_green')[0]).toMatchObject({ text: 'Idea', fill: '#b2f2bb' });
    expect(parseCsvRows('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('comments on objects', () => {
  const frame = { id: 'f', type: 'frame', x: 0, y: 0, width: 1000, height: 1000 };
  const sticky = { id: 's', type: 'rectangle', x: 100, y: 100, width: 200, height: 150 };
  const label = { id: 't', type: 'text', x: 120, y: 120, width: 50, height: 20, containerId: 's' };
  it('picks the smallest object under the point; bound text counts as its shape', () => {
    expect(elementAt([frame, sticky, label], { x: 130, y: 130 })?.id).toBe('s');
    expect(elementAt([frame, sticky], { x: 900, y: 900 })?.id).toBe('f');
    expect(elementAt([sticky], { x: 900, y: 900 })).toBeNull();
  });
  it('the pin follows its object and stays put when the object is gone', () => {
    const th = { x: 150, y: 120, element_id: 's', anchor_x: 100, anchor_y: 100 };
    const moved = new Map([['s', { ...sticky, x: 400, y: 50 }]]);
    expect(pinPosition(th, moved)).toEqual({ x: 450, y: 70, attached: true });
    expect(pinPosition(th, new Map())).toEqual({ x: 150, y: 120, attached: false });
    expect(pinPosition({ ...th, element_id: null }, moved).attached).toBe(false);
  });
});

describe('new templates', () => {
  const t = (k: string) => k;
  it('flowchart has labeled arrows bound to their shapes', () => {
    expect(isBoardTemplate('flowchart')).toBe(true);
    const els = buildTemplateScene('flowchart', t).elements as Array<Record<string, unknown>>;
    const labels = els.filter((e) => e.type === 'text' && e.containerId && els.find((a) => a.id === e.containerId)?.type === 'arrow');
    expect(labels.map((l) => l.text).sort()).toEqual(['flowchart.no', 'flowchart.yes']);
    const arrows = els.filter((e) => e.type === 'arrow');
    expect(arrows.length).toBe(7);
    expect(arrows.every((a) => (a.startBinding as { elementId: string }).elementId && (a.endBinding as { elementId: string }).elementId)).toBe(true);
  });
  it('user story map has activities, steps and release lanes', () => {
    const els = buildTemplateScene('storyMap', t).elements as Array<Record<string, unknown>>;
    const texts = els.filter((e) => e.type === 'text').map((e) => e.text);
    expect(texts).toContain('storyMap.release1');
    expect(texts.filter((x) => x === 'storyMap.story')).toHaveLength(6);
  });
});
