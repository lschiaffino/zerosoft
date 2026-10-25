import { describe, expect, it } from 'vitest';
import {
  blockRuleFor,
  inlineRuleFor,
  looksLikeMarkdown,
  nodesToMarkdown,
  renderEditorHtml,
  type RtNode,
} from '@/lib/track-richtext';

// HTML mínimo → árbol RtNode (lo justo para el HTML del editor y pegados simples).
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link']);
function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
function el(tag: string, attrs: Record<string, string>): RtNode & { childNodes: RtNode[] } {
  const node = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    childNodes: [] as RtNode[],
    get textContent(): string {
      return this.childNodes.map((c: RtNode) => c.textContent ?? '').join('');
    },
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
  };
  return node;
}
function parse(html: string): RtNode {
  const root = el('div', {});
  const stack = [root];
  const re = /<\/?([a-zA-Z0-9]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[3] !== undefined) {
      top.childNodes.push({ nodeType: 3, nodeName: '#text', childNodes: [], textContent: decode(m[3]) });
      continue;
    }
    const tag = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      const i = stack.map((n) => n.nodeName).lastIndexOf(tag.toUpperCase());
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const node = el(tag, attrs);
    top.childNodes.push(node);
    if (!VOID.has(tag) && !m[0].endsWith('/>')) stack.push(node);
  }
  return root;
}
const roundTrip = (md: string) => nodesToMarkdown(parse(renderEditorHtml(md)));

describe('track-richtext: markdown ↔ editor', () => {
  it('conserva el markdown de siempre al pasar por el editor', () => {
    const cases = [
      '# Título\n\nUn párrafo con **negrita**, *itálica*, ~~tachado~~ y `código`.',
      '## Pasos\n\n1. Abrir /pricing\n2. Tocar Comprar',
      '- uno\n- dos\n  - anidado',
      '- [ ] pendiente\n- [x] hecho',
      '> una cita\n> de dos líneas',
      '```ts\nconst a = 1;\nconst b = `x`;\n```',
      'Ver ZER-12 y avisar a @ana@example.com',
      '[docs](https://example.com/a) y https://example.com',
      '![captura](/uploads/a.png)',
      '---',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      'línea uno\nlínea dos',
    ];
    for (const md of cases) expect(roundTrip(md)).toBe(md);
  });

  it('las tareas son li[data-task] (sin input) y se tildan por atributo', () => {
    const html = renderEditorHtml('- [ ] a\n- [x] b');
    expect(html).toContain('data-task="1" data-checked="false"');
    expect(html).toContain('data-checked="true"');
    expect(html).not.toContain('<input');
    expect(nodesToMarkdown(parse(html.replace('data-checked="false"', 'data-checked="true"')))).toBe('- [x] a\n- [x] b');
  });

  it('referencias y menciones quedan como chips con su texto original', () => {
    const html = renderEditorHtml('ZER-12 @ana@example.com');
    expect(html).toContain('contenteditable="false" data-md="ZER-12"');
    expect(html).toContain('data-md="@ana@example.com"');
  });

  it('sigue siendo seguro: HTML crudo escapado y hrefs peligrosos fuera', () => {
    const html = renderEditorHtml('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('javascript:');
  });

  it('escapa en el texto lo que markdown leería como formato', () => {
    const md = nodesToMarkdown(parse('<p>2 * 3 = 6 y snake_case y _raro_</p><p># no es título</p><p>1. no es lista</p>'));
    expect(md).toBe('2 \\* 3 = 6 y snake_case y \\_raro\\_\n\n\\# no es título\n\n1\\. no es lista');
  });

  it('HTML pegado (Google Docs, otra web) pasa a markdown limpio', () => {
    const md = nodesToMarkdown(
      parse('<meta charset="utf-8"><div><b>Hola</b> <span style="x">mundo</span></div><ul><li>a</li><li>b</li></ul><script>x</script><h2>Fin</h2>'),
    );
    expect(md).toBe('**Hola** mundo\n\n- a\n- b\n\n## Fin');
  });

  it('párrafos y saltos del contenteditable (div, br, nbsp, vacíos)', () => {
    expect(nodesToMarkdown(parse('<p>uno<br>dos</p><p><br></p><div>tres&nbsp;cuatro</div>'))).toBe('uno\ndos\n\ntres cuatro');
    expect(nodesToMarkdown(parse('<p><br></p>'))).toBe('');
    expect(nodesToMarkdown(parse('suelto <strong> negrita </strong>fin'))).toBe('suelto **negrita** fin');
  });

  it('reglas de escritura como Linear', () => {
    expect(blockRuleFor('# ')).toEqual({ kind: 'heading', level: 1 });
    expect(blockRuleFor('### ')).toEqual({ kind: 'heading', level: 3 });
    expect(blockRuleFor('- ')).toEqual({ kind: 'bullet' });
    expect(blockRuleFor('1. ')).toEqual({ kind: 'numbered' });
    expect(blockRuleFor('[] ')).toEqual({ kind: 'todo', checked: false });
    expect(blockRuleFor('[x] ')).toEqual({ kind: 'todo', checked: true });
    expect(blockRuleFor('> ')).toEqual({ kind: 'quote' });
    expect(blockRuleFor('```ts')).toEqual({ kind: 'code', lang: 'ts' });
    expect(blockRuleFor('hola ')).toBeNull();
    expect(inlineRuleFor('es **muy**')).toEqual({ tag: 'strong', start: 3, text: 'muy' });
    expect(inlineRuleFor('es *muy*')).toEqual({ tag: 'em', start: 3, text: 'muy' });
    expect(inlineRuleFor('es _muy_')).toEqual({ tag: 'em', start: 3, text: 'muy' });
    expect(inlineRuleFor('usá `npm i`')).toEqual({ tag: 'code', start: 4, text: 'npm i' });
    expect(inlineRuleFor('~~no~~')).toEqual({ tag: 's', start: 0, text: 'no' });
    expect(inlineRuleFor('snake_case_')).toBeNull();
    expect(inlineRuleFor('2 * 3 *')).toBeNull();
    expect(looksLikeMarkdown('# hola')).toBe(true);
    expect(looksLikeMarkdown('hola che')).toBe(false);
  });
});
