import katex from 'katex';

/**
 * Ecuaciones de Docs con KaTeX (sin comandos peligrosos: `trust` apagado).
 * Sirve en el servidor y en el navegador: el bloque ecuación guarda el LaTeX
 * escapado como texto; las ecuaciones en línea son <span data-tex="…">.
 */

export function renderTex(tex: string, display: boolean): string {
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
