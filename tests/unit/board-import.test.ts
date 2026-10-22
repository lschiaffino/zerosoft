import { describe, expect, it } from 'vitest';
import { importedBoardName, parseExcalidrawScene } from '@/lib/board-import';

const rect = { id: 'a', type: 'rectangle', x: 0, y: 0 };

describe('parseExcalidrawScene', () => {
  it('acepta un archivo .excalidraw y descarta elementos borrados', () => {
    const scene = parseExcalidrawScene({ type: 'excalidraw', elements: [rect, { ...rect, id: 'b', isDeleted: true }], appState: { viewBackgroundColor: '#fff' } });
    expect(scene?.elements).toHaveLength(1);
    expect(scene?.appState).toEqual({ viewBackgroundColor: '#fff' });
  });

  it('acepta el JSON como texto', () => {
    expect(parseExcalidrawScene(JSON.stringify({ elements: [rect] }))?.elements).toHaveLength(1);
  });

  it('rechaza lo que no es un dibujo', () => {
    expect(parseExcalidrawScene('no es json')).toBeNull();
    expect(parseExcalidrawScene({ type: 'otro', elements: [] })).toBeNull();
    expect(parseExcalidrawScene({ elements: 'x' })).toBeNull();
    expect(parseExcalidrawScene(null)).toBeNull();
  });

  it('ignora elementos sin id o tipo', () => {
    expect(parseExcalidrawScene({ elements: [{ type: 'rectangle' }, { id: 'x' }, rect] })?.elements).toHaveLength(1);
  });

  it('conserva solo los archivos que usa una imagen', () => {
    const scene = parseExcalidrawScene({
      elements: [{ id: 'i', type: 'image', fileId: 'f1' }],
      files: { f1: { id: 'f1' }, f2: { id: 'f2' } },
    });
    expect(Object.keys(scene!.files)).toEqual(['f1']);
  });

  it('rechaza escenas que superan el tope', () => {
    const big = { id: 'i', type: 'image', fileId: 'f' };
    expect(parseExcalidrawScene({ elements: [big], files: { f: { dataURL: 'x'.repeat(5 * 1024 * 1024) } } })).toBeNull();
  });
});

describe('importedBoardName', () => {
  it('saca la extensión', () => {
    expect(importedBoardName('Roadmap Q4.excalidraw')).toBe('Roadmap Q4');
    expect(importedBoardName('x.JSON')).toBe('x');
  });
});
