import katex from 'katex';

/**
 * Dibuja una ecuación en línea dentro de su span sin tocar el texto del span
 * (el LaTeX): el render va en un shadow root, así el caret y los offsets del
 * modelo (que cuentan el texto del span) siguen iguales. Salida MathML (el
 * navegador la dibuja sin la hoja de estilos de KaTeX).
 */
export function renderInlineTex(span: HTMLElement, tex: string): void {
  if (typeof span.attachShadow !== 'function') return;
  const root = span.shadowRoot ?? span.attachShadow({ mode: 'open' });
  if (root.host.getAttribute('data-rendered') === tex) return;
  let html = '';
  try {
    html = katex.renderToString(tex, { displayMode: false, throwOnError: false, trust: false, strict: 'ignore', output: 'mathml' });
  } catch {
    html = '';
  }
  root.innerHTML = `<style>:host{display:inline-block;cursor:pointer;padding:0 2px;border-radius:3px}math{font-size:1.05em}</style>${html || '<span>?</span>'}`;
  span.setAttribute('data-rendered', tex);
}
