import { describe, expect, it } from 'vitest';
import { applyMarkdownAction, renderTrackMarkdown, safeHref } from '@/lib/track-markdown';

describe('renderTrackMarkdown', () => {
  it('renderiza markdown básico', () => {
    const html = renderTrackMarkdown('**bold** _it_ `code`\n\n- a\n- b\n\n[x](https://e.com)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<a href="https://e.com" target="_blank" rel="nofollow noopener noreferrer">x</a>');
  });

  it('escapa HTML crudo y bloquea esquemas peligrosos', () => {
    const vectors = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'hi <b onclick="x()">b</b>',
      '[x](javascript:alert(1))',
      '[x](JaVa\tScRiPt:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '![i](javascript:alert(1))',
      '[x](https://e.com "a\\" onmouseover=\\"x")',
      '<div>\n<iframe src="https://e.com"></iframe>\n</div>',
      '[x](//evil.com)',
      '<javascript:alert(1)>',
    ];
    for (const v of vectors) {
      const html = renderTrackMarkdown(v);
      expect(html, v).not.toMatch(/<(script|img|iframe|div|b)\b/i);
      expect(html, v).not.toMatch(/href="\s*(javascript|data|\/\/)/i);
      expect(html, v).not.toMatch(/\son\w+="/i);
    }
  });

  it('las imágenes quedan como link', () => {
    expect(renderTrackMarkdown('![logo](https://e.com/a.png)')).toBe(
      '<p><a href="https://e.com/a.png" target="_blank" rel="nofollow noopener noreferrer">logo</a></p>',
    );
  });

  it('marca menciones fuera del código', () => {
    const html = renderTrackMarkdown('hola @ana@x.com y @Juan Perez\n\n`@nope`');
    expect(html).toContain('<span class="track-mention" data-mention="@ana@x.com">@ana@x.com</span>');
    expect(html).toContain('<span class="track-mention" data-mention="@Juan Perez">@Juan Perez</span>');
    expect(html).toContain('<code>@nope</code>');
  });

  it('vacío → vacío', () => {
    expect(renderTrackMarkdown('   ')).toBe('');
  });
});

describe('safeHref', () => {
  it('permite http, mailto y relativos', () => {
    expect(safeHref('https://a.com')).toBe('https://a.com');
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeHref('/app/track')).toBe('/app/track');
    expect(safeHref('vbscript:x')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});

describe('applyMarkdownAction', () => {
  it('envuelve la selección', () => {
    expect(applyMarkdownAction('hola mundo', 5, 10, 'bold')).toEqual({
      value: 'hola **mundo**',
      selectionStart: 7,
      selectionEnd: 12,
    });
    expect(applyMarkdownAction('ab', 1, 1, 'italic', 'texto').value).toBe('a_texto_b');
    expect(applyMarkdownAction('x', 0, 1, 'code').value).toBe('`x`');
    expect(applyMarkdownAction('a\nb', 0, 3, 'code').value).toBe('```\na\nb\n```');
  });

  it('link selecciona la URL', () => {
    const r = applyMarkdownAction('ver docs', 4, 8, 'link');
    expect(r.value).toBe('ver [docs](https://)');
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe('https://');
  });

  it('lista alterna las líneas tocadas', () => {
    const r = applyMarkdownAction('a\nb\nc', 0, 3, 'list');
    expect(r.value).toBe('- a\n- b\nc');
    expect(applyMarkdownAction(r.value, 0, 7, 'list').value).toBe('a\nb\nc');
  });
});
