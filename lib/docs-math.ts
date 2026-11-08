import type KatexModule from 'katex';

/**
 * Ecuaciones de Docs con KaTeX (sin comandos peligrosos: `trust` apagado).
 * Sirve en el servidor y en el navegador: el bloque ecuación guarda el LaTeX
 * escapado como texto; las ecuaciones en línea son <span data-tex="…">.
 *
 * En el navegador KaTeX (~270 KB) se baja recién cuando una página tiene una
 * ecuación: mientras tanto se muestra el LaTeX y, al llegar, se dibuja.
 */
type Katex = typeof KatexModule;

// En el servidor se carga al toque (Next saca esta rama del bundle del navegador).
// eslint-disable-next-line @typescript-eslint/no-require-imports
let katex: Katex | null = typeof window === 'undefined' ? (require('katex') as Katex) : null;
let loading: Promise<Katex> | null = null;

/** KaTeX ya cargado (o null en el navegador hasta que llegue). */
export function katexNow(): Katex | null {
  return katex;
}

/** Baja KaTeX una sola vez y dibuja lo que quedó esperando. */
export function loadKatex(): Promise<Katex> {
  if (katex) return Promise.resolve(katex);
  loading ??= import('katex').then((m) => {
    katex = ((m as unknown as { default?: Katex }).default ?? m) as Katex;
    if (typeof document !== 'undefined') {
      for (const el of document.querySelectorAll<HTMLElement>('[data-tex-pending]')) {
        const html = renderTex(el.getAttribute('data-tex-pending') ?? '', el.hasAttribute('data-tex-display'));
        if (html) el.outerHTML = html;
      }
    }
    return katex;
  });
  return loading;
}

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderTex(tex: string, display: boolean): string {
  if (!katex) {
    void loadKatex();
    // El LaTeX tal cual hasta que llegue KaTeX (loadKatex lo reemplaza).
    return `<span class="docs-tex-pending" data-tex-pending="${escAttr(tex)}"${display ? ' data-tex-display=""' : ''}>${escAttr(tex)}</span>`;
  }
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml' });
  } catch {
    return '';
  }
}

/** LaTeX de un bloque ecuación (el content está escapado como HTML). */
export function texFromContent(content: string): string {
  return content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

export function texToContent(tex: string): string {
  return tex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML-lite con las ecuaciones en línea dibujadas (para las vistas de lectura). */
export function withInlineMath(html: string): string {
  if (!html || !html.includes('data-tex')) return html;
  return html.replace(/<span data-tex="([^"]*)">[^<]*<\/span>/g, (_, attr: string) => {
    const tex = texFromContent(attr);
    const out = renderTex(tex, false);
    return out ? `<span class="dbv-inline-eq">${out}</span>` : _;
  });
}
