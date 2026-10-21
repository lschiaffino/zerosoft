import { describe, expect, it } from 'vitest';
import type { DocsBlock } from '@/lib/docs-types';
import {
  blocksToTree,
  deleteRange,
  duplicateRange,
  expandRange,
  hiddenBlocks,
  indentRange,
  listNumbers,
  moveRange,
  normalizeIndents,
  subtreeEnd,
} from '@/lib/docs-blocks';
import { htmlToBlocks, shouldSplitPaste } from '@/lib/docs-paste';
import { docsImportKind, looksLikeMarkdown, markdownToBlocks, plainTextToBlocks } from '@/lib/docs-import';
import { sanitizeBlocks, sanitizeDocsHtml } from '@/lib/docs-sanitize';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { docsBlockSchema } from '@/lib/docs-schema';

const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};
const b = (id: string, indent = 0, extra: Partial<DocsBlock> = {}): DocsBlock => ({
  id,
  type: 'paragraph',
  content: id,
  ...(indent ? { indent } : {}),
  ...extra,
});
const order = (blocks: DocsBlock[]) => blocks.map((x) => `${x.id}:${x.indent ?? 0}`).join(' ');

// ---------- 1. Bloques anidados, toggles y callouts ----------

describe('Docs: estructura de bloques anidados', () => {
  const doc = [b('a'), b('a1', 1), b('a11', 2), b('a2', 1), b('c')];

  it('subárbol, rango estirado y bloques ocultos por un toggle plegado', () => {
    expect(subtreeEnd(doc, 0)).toBe(3);
    expect(subtreeEnd(doc, 1)).toBe(2);
    expect(subtreeEnd(doc, 4)).toBe(4);
    expect(expandRange(doc, 1, 1)).toEqual([1, 2]);
    const toggled = [b('t', 0, { type: 'toggle', collapsed: true }), b('x', 1), b('y', 2), b('z')];
    expect(hiddenBlocks(toggled)).toEqual([false, true, true, false]);
    const heading = [b('h', 0, { type: 'heading', level: 2, toggle: true, collapsed: true }), b('x', 1)];
    expect(hiddenBlocks(heading)).toEqual([false, true]);
    // Un heading sin toggle no pliega aunque traiga collapsed.
    expect(hiddenBlocks([b('h', 0, { type: 'heading', collapsed: true }), b('x', 1)])).toEqual([false, false]);
  });

  it('Tab anida con los hijos; el primero y un salto de dos niveles no se anidan', () => {
    expect(indentRange(doc, 0, 0, 1)).toBeNull();
    const next = indentRange(doc, 4, 4, 1)!;
    expect(order(next)).toBe('a:0 a1:1 a11:2 a2:1 c:1');
    // a2 ya está un nivel debajo de a11? no: a11 es más profundo, se permite.
    expect(order(indentRange(doc, 3, 3, 1)!)).toBe('a:0 a1:1 a11:2 a2:2 c:0');
    // a11 ya está un nivel más que a1: otro Tab lo dejaría a dos niveles.
    expect(indentRange(doc, 2, 2, 1)).toBeNull();
    // Tab sobre a1 lleva a su hijo a11.
    expect(indentRange(doc, 1, 1, 1)).toBeNull();
  });

  it('Shift+Tab desanida; sin indent no hace nada', () => {
    expect(order(indentRange(doc, 1, 1, -1)!)).toBe('a:0 a1:0 a11:1 a2:1 c:0');
    expect(indentRange(doc, 4, 4, -1)).toBeNull();
  });

  it('normaliza indents imposibles', () => {
    expect(order(normalizeIndents([b('x', 2), b('y', 4), b('z', 1)]))).toBe('x:0 y:1 z:1');
    const ok = [b('x'), b('y', 1)];
    expect(normalizeIndents(ok)).toBe(ok);
  });

  it('numeración por nivel: los hijos no cortan la cuenta del padre', () => {
    const n = (id: string, indent = 0) => b(id, indent, { type: 'numbered_list_item' });
    expect(listNumbers([n('1'), n('1a', 1), n('1b', 1), n('2'), b('p'), n('1')])).toEqual([1, 1, 2, 2, 0, 1]);
  });

  it('árbol para el render de solo lectura', () => {
    const tree = blocksToTree(doc);
    expect(tree.map((x) => x.block.id)).toEqual(['a', 'c']);
    expect(tree[0].children.map((x) => x.block.id)).toEqual(['a1', 'a2']);
    expect(tree[0].children[0].children.map((x) => x.block.id)).toEqual(['a11']);
  });

  it('el schema acepta toggle, callout, indent y collapsed; rechaza indent fuera de rango', () => {
    expect(docsBlockSchema.safeParse({ id: 'x', type: 'toggle', content: '', collapsed: true, indent: 2 }).success).toBe(true);
    expect(docsBlockSchema.safeParse({ id: 'x', type: 'callout', content: '', icon: '💡' }).success).toBe(true);
    expect(docsBlockSchema.safeParse({ id: 'x', type: 'heading', level: 1, content: '', toggle: true }).success).toBe(true);
    expect(docsBlockSchema.safeParse({ id: 'x', type: 'paragraph', content: '', indent: 99 }).success).toBe(false);
  });

  it('el export a Markdown indenta los hijos y escribe toggles y callouts', () => {
    const md = blocksToMarkdown([
      b('Lista', 0, { type: 'bulleted_list_item', content: 'uno' }),
      b('x', 1, { type: 'bulleted_list_item', content: 'hijo' }),
      b('t', 0, { type: 'toggle', content: 'Detalles' }),
      b('c', 0, { type: 'callout', icon: '⚠️', content: 'Ojo' }),
    ]);
    expect(md).toContain('- uno\n  - hijo');
    expect(md).toContain('- Detalles');
    expect(md).toContain('> ⚠️ Ojo');
  });
});

// ---------- 2. Selección de varios bloques ----------

describe('Docs: mover, duplicar y borrar varios bloques', () => {
  const doc = [b('a'), b('a1', 1), b('b'), b('b1', 1), b('c')];

  it('borrar se lleva a los hijos y nunca deja la página vacía', () => {
    const res = deleteRange(doc, 0, 0, ids());
    expect(order(res.blocks)).toBe('b:0 b1:1 c:0');
    const all = deleteRange(doc, 0, 4, ids());
    expect(all.blocks).toHaveLength(1);
    expect(all.blocks[0]).toMatchObject({ type: 'paragraph', content: '' });
  });

  it('duplicar copia el subárbol debajo con ids nuevos', () => {
    const res = duplicateRange(doc, 2, 2, ids());
    expect(res.blocks.map((x) => x.content)).toEqual(['a', 'a1', 'b', 'b1', 'b', 'b1', 'c']);
    expect(new Set(res.blocks.map((x) => x.id)).size).toBe(7);
    expect(res.start).toBe(4);
  });

  it('mover salta el subárbol del hermano; en el borde devuelve null', () => {
    const up = moveRange(doc, 2, 2, -1)!;
    expect(order(up.blocks)).toBe('b:0 b1:1 a:0 a1:1 c:0');
    expect(up.start).toBe(0);
    const down = moveRange(doc, 0, 0, 1)!;
    expect(order(down.blocks)).toBe('b:0 b1:1 a:0 a1:1 c:0');
    expect(down.start).toBe(2);
    expect(moveRange(doc, 0, 0, -1)).toBeNull();
    expect(moveRange(doc, 4, 4, 1)).toBeNull();
  });

  it('el último hijo baja como primer hijo del bloque siguiente (y lo despliega)', () => {
    const list = [b('a'), b('a1', 1), b('t', 0, { type: 'toggle', collapsed: true }), b('t1', 1)];
    const res = moveRange(list, 1, 1, 1)!;
    expect(order(res.blocks)).toBe('a:0 t:0 a1:1 t1:1');
    expect(res.blocks[1].collapsed).toBe(false);
  });

  it('un rango de varios bloques se mueve entero', () => {
    const res = moveRange(doc, 2, 4, -1)!;
    expect(res.blocks.map((x) => x.id)).toEqual(['b', 'b1', 'c', 'a', 'a1']);
    expect([res.start, res.end]).toEqual([0, 2]);
  });
});

// ---------- 3. Pegar Markdown/HTML e importar ----------

describe('Docs: pegar HTML como bloques', () => {
  const opts = { sanitize: sanitizeDocsHtml, newId: ids() };

  it('Google Docs: headings, listas anidadas, tareas, código, tabla; el wrapper <b> no marca', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
      '<h1>Title</h1><p><span style="font-weight:700">Bold</span> text &amp; more</p>' +
      '<ul><li><p>One</p></li><li>Two<ul><li>Nested <a href="https://x.com">link</a></li></ul></li></ul>' +
      '<ul><li><input type="checkbox" checked> done</li></ul>' +
      '<blockquote><p>q</p></blockquote>' +
      '<pre><code class="language-js">const a = 1;\nb &lt; 2</code></pre><hr>' +
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2 &amp; 3</td></tr></table>' +
      '<script>alert(1)</script></b>';
    const blocks = htmlToBlocks(html, opts);
    expect(blocks.map((x) => [x.type, x.content, x.indent ?? 0])).toEqual([
      ['heading', 'Title', 0],
      ['paragraph', '<strong>Bold</strong> text &amp; more', 0],
      ['bulleted_list_item', 'One', 0],
      ['bulleted_list_item', 'Two', 0],
      ['bulleted_list_item', 'Nested <a href="https://x.com" target="_blank" rel="noopener noreferrer">link</a>', 1],
      ['todo', 'done', 0],
      ['quote', 'q', 0],
      ['code', 'const a = 1;\nb &lt; 2', 0],
      ['divider', '', 0],
      ['table', '', 0],
    ]);
    expect(blocks[0].level).toBe(1);
    expect(blocks[5].checked).toBe(true);
    expect(blocks[7].language).toBe('js');
    expect(blocks[9].rows).toEqual([['A', 'B'], ['1', '2 & 3']]);
    expect(JSON.stringify(blocks)).not.toContain('alert');
  });

  it('sanea: sin scripts, sin handlers ni javascript:', () => {
    const blocks = htmlToBlocks('<p onclick="x()">a<img src=x onerror=alert(1)></p><p><a href="javascript:alert(1)">b</a></p>', opts);
    const json = JSON.stringify(blocks);
    expect(json).not.toMatch(/onclick|onerror|javascript:/);
    expect(blocks.map((x) => x.content)).toEqual(['a', '<a>b</a>'].map((c) => sanitizeDocsHtml(c)));
  });

  it('un solo párrafo sigue siendo un pegado en línea', () => {
    expect(shouldSplitPaste(htmlToBlocks('<span>hola <b>mundo</b></span>', opts))).toBe(false);
    expect(shouldSplitPaste(htmlToBlocks('<p>a</p><p>b</p>', opts))).toBe(true);
    expect(shouldSplitPaste(htmlToBlocks('<h2>a</h2>', opts))).toBe(true);
  });
});

describe('Docs: pegar e importar Markdown', () => {
  it('listas anidadas con indent, tareas, alertas como callout', () => {
    const blocks = markdownToBlocks('# T\n\n- a\n  - b\n    - c\n- [x] d\n\n> [!WARNING]\n> cuidado\n\n1. x\n2. y\n', {
      sanitize: sanitizeDocsHtml,
      newId: ids(),
    });
    expect(blocks.map((x) => [x.type, x.content, x.indent ?? 0])).toEqual([
      ['heading', 'T', 0],
      ['bulleted_list_item', 'a', 0],
      ['bulleted_list_item', 'b', 1],
      ['bulleted_list_item', 'c', 2],
      ['todo', 'd', 0],
      ['callout', 'cuidado', 0],
      ['numbered_list_item', 'x', 0],
      ['numbered_list_item', 'y', 0],
    ]);
    expect(blocks[5].icon).toBe('⚠️');
  });

  it('el Markdown con HTML peligroso sale saneado', () => {
    const blocks = sanitizeBlocks(
      markdownToBlocks('hola <script>alert(1)</script> [x](javascript:alert(1))', { sanitize: sanitizeDocsHtml }),
    );
    expect(JSON.stringify(blocks)).not.toMatch(/<script|javascript:/);
  });

  it('heurística de Markdown, texto plano por líneas y tipos de archivo', () => {
    expect(looksLikeMarkdown('## Hola\ntexto')).toBe(true);
    expect(looksLikeMarkdown('- uno\n- dos')).toBe(true);
    expect(looksLikeMarkdown('Hola\nchau')).toBe(false);
    expect(plainTextToBlocks('a\r\n<b>', ids()).map((x) => x.content)).toEqual(['a', '&lt;b&gt;']);
    expect(docsImportKind('Nota.MD')).toBe('markdown');
    expect(docsImportKind('informe.docx')).toBe('docx');
    expect(docsImportKind('x.pdf')).toBeNull();
  });
});
