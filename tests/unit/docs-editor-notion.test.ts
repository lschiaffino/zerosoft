import { describe, expect, it } from 'vitest';
import type { DocsBlock } from '@/lib/docs-types';
import { listDepths, listNumbers, numberedMarker } from '@/lib/docs-blocks';
import { matchInlineMarkdown } from '@/lib/docs-richtext';
import { htmlToBlocks } from '@/lib/docs-paste';
import { sanitizeDocsHtml } from '@/lib/docs-sanitize';

/**
 * Docs como reemplazo de Notion: marcas de lista por nivel, Markdown en línea
 * al tipear y pegar lo que copia Notion (tareas, toggles, callouts).
 */

const blk = (id: string, type: DocsBlock['type'], indent = 0): DocsBlock => ({ id, type, content: id, ...(indent ? { indent } : {}) });

describe('Docs: marcas de lista por nivel', () => {
  it('el nivel cuenta solo ancestros que son ítems de lista', () => {
    const blocks = [
      blk('p', 'paragraph'),
      blk('a', 'bulleted_list_item'),
      blk('a1', 'bulleted_list_item', 1),
      blk('a11', 'numbered_list_item', 2),
      blk('a111', 'numbered_list_item', 3),
      blk('t', 'toggle'),
      blk('t1', 'bulleted_list_item', 1),
      blk('q', 'paragraph', 1),
      blk('q1', 'bulleted_list_item', 2),
    ];
    expect(listDepths(blocks)).toEqual([0, 0, 1, 2, 3, 0, 0, 0, 0]);
  });

  it('números: 1. → a. → i. y vuelve a empezar', () => {
    expect([1, 2, 10].map((n) => numberedMarker(n, 0))).toEqual(['1', '2', '10']);
    expect([1, 2, 26, 27, 28].map((n) => numberedMarker(n, 1))).toEqual(['a', 'b', 'z', 'aa', 'ab']);
    expect([1, 4, 9, 14, 40].map((n) => numberedMarker(n, 2))).toEqual(['i', 'iv', 'ix', 'xiv', 'xl']);
    expect(numberedMarker(3, 3)).toBe('3');
    expect(numberedMarker(0, 0)).toBe('');
  });

  it('la cuenta reinicia después de un párrafo y sigue después de los hijos', () => {
    const blocks = [
      blk('1', 'numbered_list_item'),
      blk('2', 'numbered_list_item'),
      blk('2a', 'numbered_list_item', 1),
      blk('2b', 'numbered_list_item', 1),
      blk('3', 'numbered_list_item'),
      blk('p', 'paragraph'),
      blk('r1', 'numbered_list_item'),
    ];
    expect(listNumbers(blocks)).toEqual([1, 2, 1, 2, 3, 0, 1]);
  });
});

describe('Docs: Markdown en línea al tipear', () => {
  it('negrita, cursiva, código y tachado al cerrar la marca', () => {
    expect(matchInlineMarkdown('hola **mundo**')).toEqual({ tag: 'strong', start: 5, delim: 2, inner: 'mundo' });
    expect(matchInlineMarkdown('hola *mundo*')).toEqual({ tag: 'em', start: 5, delim: 1, inner: 'mundo' });
    expect(matchInlineMarkdown('a _b c_')).toEqual({ tag: 'em', start: 2, delim: 1, inner: 'b c' });
    expect(matchInlineMarkdown('run `npm test`')).toEqual({ tag: 'code', start: 4, delim: 1, inner: 'npm test' });
    expect(matchInlineMarkdown('~~old~~')).toEqual({ tag: 's', start: 0, delim: 2, inner: 'old' });
    expect(matchInlineMarkdown('__big__')).toEqual({ tag: 'strong', start: 0, delim: 2, inner: 'big' });
  });

  it('no confunde lo que no es una marca', () => {
    expect(matchInlineMarkdown('**mundo*')).toBeNull();
    expect(matchInlineMarkdown('2 * 3 *')).toBeNull();
    expect(matchInlineMarkdown('snake_case_name')).toBeNull();
    expect(matchInlineMarkdown('** **')).toBeNull();
    expect(matchInlineMarkdown('sin marcas')).toBeNull();
  });
});

describe('Docs: pegar desde Notion', () => {
  const opts = () => {
    let n = 0;
    return { sanitize: sanitizeDocsHtml, newId: () => `n${++n}` };
  };
  const shape = (blocks: DocsBlock[]) => blocks.map((x) => [x.type, x.content, x.indent ?? 0]);

  it('tareas con su casilla, toggles con hijos, toggle headings y callouts con ícono', () => {
    const html =
      '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Hecha</span></li>' +
      '<li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Pendiente</span></li></ul>' +
      '<ul class="toggle"><li><details open=""><summary>Toggle</summary><p>Adentro</p><ul><li>Hijo</li></ul></details></li></ul>' +
      '<details><summary><h3>Sección</h3></summary><p>Cuerpo</p></details>' +
      '<figure class="callout"><div style="font-size:1.5em"><span class="icon">⚠️</span></div><div style="width:100%">Ojo con esto</div></figure>' +
      '<p>Después</p>';
    const blocks = htmlToBlocks(html, opts());
    expect(shape(blocks)).toEqual([
      ['todo', 'Hecha', 0],
      ['todo', 'Pendiente', 0],
      ['toggle', 'Toggle', 0],
      ['paragraph', 'Adentro', 1],
      ['bulleted_list_item', 'Hijo', 1],
      ['heading', 'Sección', 0],
      ['paragraph', 'Cuerpo', 1],
      ['callout', 'Ojo con esto', 0],
      ['paragraph', 'Después', 0],
    ]);
    expect(blocks.map((x) => x.checked)).toEqual([true, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(blocks[5]).toMatchObject({ level: 3, toggle: true });
    expect(blocks[7].icon).toBe('⚠️');
  });

  it('el <aside> del Markdown de Notion es un callout', () => {
    expect(shape(htmlToBlocks('<aside>💡 Nota</aside><p>x</p>', opts()))).toEqual([
      ['callout', '💡 Nota', 0],
      ['paragraph', 'x', 0],
    ]);
  });
});
