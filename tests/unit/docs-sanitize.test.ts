import { describe, expect, it } from 'vitest';
import { sanitizeBlocks, sanitizeDocsHtml } from '@/lib/docs-sanitize';

describe('Docs: sanitización en el servidor', () => {
  it('conserva el formato permitido', () => {
    expect(sanitizeDocsHtml('<strong>a</strong> <em>b</em> <code>c</code>')).toBe('<strong>a</strong> <em>b</em> <code>c</code>');
    expect(sanitizeDocsHtml('<a href="https://x.com">x</a>')).toBe(
      '<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('elimina scripts, handlers y javascript:', () => {
    expect(sanitizeDocsHtml('<img src=x onerror=alert(1)>hola')).toBe('hola');
    expect(sanitizeDocsHtml('<script>alert(1)</script>ok')).toBe('ok');
    expect(sanitizeDocsHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitizeDocsHtml('<strong onclick="x()">a</strong>')).toBe('<strong>a</strong>');
  });

  it('el texto plano y lo escapado no cambian', () => {
    expect(sanitizeDocsHtml('texto plano')).toBe('texto plano');
    expect(sanitizeDocsHtml('a &lt;div&gt; b')).toBe('a &lt;div&gt; b');
  });

  it('sanitiza también las celdas de tablas', () => {
    const [b] = sanitizeBlocks([{ id: '1', type: 'table', content: '', rows: [['<svg onload=x()>', 'ok']] }]);
    expect(b.rows).toEqual([['', 'ok']]);
  });
});
