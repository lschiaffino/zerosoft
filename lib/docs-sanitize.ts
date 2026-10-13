import sanitizeHtml from 'sanitize-html';
import type { DocsBlock } from './docs-types';

/**
 * Sanitización de Docs en el servidor. El editor ya sanitiza en el navegador
 * (lib/docs-richtext.ts), pero la API acepta cualquier JSON: sin esto se podía
 * guardar HTML arbitrario que luego se renderiza con innerHTML (XSS almacenado).
 * Mismo subset que el editor: strong/em/u/s/code y links http(s)/mailto/tel/relativos.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'a', 'br'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { href: attribs.href ?? '', target: '_blank', rel: 'noopener noreferrer' },
    }),
  },
};

export function sanitizeDocsHtml(html: string): string {
  if (!html || !/[<&]/.test(html)) return html;
  return sanitizeHtml(html, OPTIONS);
}

function plainCell(cell: unknown): string {
  return String(cell ?? '').replace(/<[^>]*>?/g, '').slice(0, 5000);
}

export function sanitizeBlocks(blocks: DocsBlock[]): DocsBlock[] {
  return blocks.map((b) => ({
    ...b,
    content: sanitizeDocsHtml(b.content),
    // Las celdas de tablas/bases son texto plano (se renderizan en <input> y
    // como texto, nunca con innerHTML): escaparlas como HTML mostraba "&amp;"
    // y lo duplicaba en cada guardado.
    // Igual se sacan las etiquetas (defensa por si algún cliente de la API las renderiza).
    ...(b.rows ? { rows: b.rows.map((row) => row.map(plainCell)) } : {}),
  }));
}
