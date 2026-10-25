import { describe, expect, it } from 'vitest';
import {
  blockRuleFor,
  inlineRuleFor,
  looksLikeMarkdown,
  nodesToMarkdown,
  renderEditorHtml,
  type RtNode,
} from '@/lib/track-richtext';
import { renderTrackMarkdown, scanToggle, scanCallout } from '@/lib/track-markdown';

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

describe('track editor: colapsables, callouts y citas (como Linear)', () => {
  it('">>> " crea un colapsable y "> " una cita', () => {
    expect(blockRuleFor('>>> ')).toEqual({ kind: 'toggle' });
    expect(blockRuleFor('> ')).toEqual({ kind: 'quote' });
  });

  it('el colapsable y el callout van y vuelven por el editor sin cambios', () => {
    const cases = [
      '+++ Detalles\nCuerpo con **negrita**\n\n- uno\n- dos\n+++',
      '+++ Vacío\n+++',
      '+++ Afuera\n+++ Adentro\nhola\n+++\n+++',
      '> [!NOTE]\n> Ojo con esto',
      '> [!WARNING]\n> Primera\n>\n> Segunda',
      'Antes\n\n+++ T\nx\n+++\n\nDespués',
    ];
    for (const md of cases) expect(roundTrip(md)).toBe(md);
  });

  it('el colapsable con cuerpo carga cerrado en el editor; el nuevo, abierto', () => {
    expect(renderEditorHtml('+++ T\nx\n+++')).toContain('data-open="false"');
    expect(renderEditorHtml('+++ T\n+++')).toContain('data-open="true"');
  });

  it('se lee como <details> y el callout como nota', () => {
    const html = renderTrackMarkdown('+++ Más info\nOculto\n+++\n\n> [!TIP]\n> Un consejo');
    expect(html).toContain('<details class="track-toggle"><summary>Más info</summary>');
    expect(html).toContain('Oculto');
    expect(html).toContain('class="track-callout" data-kind="tip" role="note"');
    expect(html).not.toContain('[!TIP]');
  });

  it('un "+++" o "[!NOTE]" escrito a mano en un párrafo no se convierte', () => {
    const p = parse('<p>+++ no es un bloque</p><blockquote><p>[!NOTE] texto</p></blockquote>');
    const md = nodesToMarkdown(p);
    expect(scanToggle(md)).toBeNull();
    expect(scanCallout(md.split('\n\n')[1])).toBeNull();
    expect(roundTrip(md)).toBe(md);
  });

  it('una cita con varios párrafos (Enter dentro de la cita) se guarda citada', () => {
    expect(nodesToMarkdown(parse('<blockquote><p>a</p><p>b</p></blockquote><p>fuera</p>'))).toBe('> a\n>\n> b\n\nfuera');
    expect(nodesToMarkdown(parse('<blockquote><p>cita</p></blockquote><pre><code>x\n</code></pre>'))).toBe('> cita\n\n```\nx\n```');
  });

  it('el <details> pegado se guarda como colapsable', () => {
    expect(nodesToMarkdown(parse('<details><summary>Título</summary><p>cuerpo</p></details>'))).toBe('+++ Título\ncuerpo\n+++');
  });

  it('las menciones leídas quedan marcadas para mostrarse con nombre', () => {
    expect(renderTrackMarkdown('hola @ana@example.com')).toContain('data-mention="@ana@example.com"');
  });
});

describe('track editor: menciones dentro del párrafo', () => {
  it('un chip de mención o issue dentro del <p> queda en la misma línea', () => {
    const html =
      '<p>hola <span class="track-chip track-chip-mention" contenteditable="false" data-md="@ana@x.io" data-mention="@ana@x.io">@Ana</span>&nbsp;y chau</p>' +
      '<ul><li>ver <span class="track-chip track-chip-issue" contenteditable="false" data-md="WEB-1" data-issue-ref="WEB-1">WEB-1</span>&nbsp;hoy</li></ul>';
    const md = nodesToMarkdown(parse(html));
    expect(md.split('\n')[0]).toBe('hola @ana@x.io y chau');
    expect(md).toContain('- ver WEB-1 hoy');
    expect(roundTrip('hola @ana@x.io y chau')).toBe('hola @ana@x.io y chau');
  });
});

import { createIssue, createProject, listIssueActivities, updateIssue } from '@/lib/track-data';
import { makeUser } from './helpers';

describe('track: quitar el padre deja rastro (como Linear)', () => {
  it('el hijo y los dos padres registran el cambio, también al deshacer', async () => {
    const u = await makeUser('ptrail');
    const p = await createProject(u.id, null, { name: 'Rastro' });
    const parent = await createIssue(p.id, u.id, { title: 'padre', description: [] });
    const child = await createIssue(p.id, u.id, { title: 'hijo', description: [], parentId: parent.id });
    await updateIssue(child.id, { parentId: null }, u.id);
    await updateIssue(child.id, { parentId: parent.id }, u.id);
    const metas = async (id: string) =>
      (await listIssueActivities(id)).filter((a) => a.type === 'cycle_change').map((a) => JSON.parse(a.meta) as Record<string, string>);
    const mine = await metas(child.id);
    expect(mine.map((m) => [m.field, m.from, m.to])).toEqual(
      expect.arrayContaining([
        ['parent', parent.identifier, ''],
        ['parent', '', parent.identifier],
      ]),
    );
    const theirs = await metas(parent.id);
    expect(theirs.map((m) => [m.field, m.action, m.child])).toEqual(
      expect.arrayContaining([
        ['subissue', 'removed', child.identifier],
        ['subissue', 'added', child.identifier],
      ]),
    );
  });
});
