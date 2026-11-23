/**
 * CRM — notas con formato y comentarios (bloque C1). Puro: lo usan el server
 * y el cliente.
 *
 * Una nota guarda su texto en `body` y el formato en `body_format`: 'text'
 * (texto plano, todas las notas de antes y las de la API que no dicen nada) o
 * 'md' (el markdown que escribe el editor con formato de Track: negrita,
 * cursiva, listas, links y @menciones como `@email`). Los comentarios son
 * siempre markdown.
 *
 * Seguridad en dos capas: al guardar, `sanitizeNoteMarkdown` saca el HTML
 * crudo, los caracteres de control y los links con esquemas que no son
 * http(s), mailto o rutas relativas; al mostrar, el render de Track
 * (lib/track-markdown.ts) vuelve a escapar todo. Nunca se guarda HTML.
 */
import { safeHref } from './track-markdown';

export const NOTE_FORMATS = ['text', 'md'] as const;
export type NoteFormat = (typeof NOTE_FORMATS)[number];

/** Tope de una nota con formato (el markdown ocupa más que el texto plano, que sigue en 5000). */
export const NOTE_MD_MAX = 20_000;
/** Tope del texto plano de una actividad (el de siempre). */
export const PLAIN_BODY_MAX = 5000;

/** ¿El cuerpo pasa su tope? Texto plano hasta PLAIN_BODY_MAX; solo una nota con formato llega a NOTE_MD_MAX. */
export function bodyTooLong(d: { type?: string; body?: string; bodyFormat?: string }, existingType?: string): boolean {
  if (d.body === undefined) return false;
  const rich = (d.type ?? existingType ?? 'note') === 'note' && d.bodyFormat === 'md';
  return d.body.length > (rich ? NOTE_MD_MAX : PLAIN_BODY_MAX);
}

/** Tope de un comentario. */
export const COMMENT_MAX = 10_000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
/** Una etiqueta HTML conocida (`<b>`, `</div>`, `<img src=x onerror=…>`). Texto como `a<b and c>d` o los autolinks `<https://…>` no entran. */
const HTML_TAG =
  /<\/?(?:a|abbr|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|font|footer|form|frame|frameset|h[1-6]|head|header|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|marquee|math|menu|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|param|picture|pre|progress|q|s|samp|script|section|select|slot|small|source|span|strong|style|sub|summary|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr|xmp)(?=[\s/>])(?:\s[^<>]*)?\/?>/gi;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
/** `[texto](destino "título")` y `![alt](destino)`. */
const INLINE_LINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^()\s<>]*)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
/** `[ref]: destino` (links por referencia). */
const REF_DEF = /^( {0,3}\[[^\]\n]+\]:\s*)(\S+)(.*)$/gm;

/**
 * Markdown de una nota o comentario listo para guardar: sin HTML crudo, sin
 * caracteres de control y sin links peligrosos (queda el texto del link).
 * Recorta al tope.
 */
export function sanitizeNoteMarkdown(markdown: string, max = NOTE_MD_MAX): string {
  let s = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '');
  s = s.replace(HTML_COMMENT, '');
  // Dos pasadas: `<<b>script>` deja otra etiqueta al sacar la primera.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(HTML_TAG, '');
    if (next === s) break;
    s = next;
  }
  s = s.replace(INLINE_LINK, (all, _bang: string, text: string, href: string) => (href && safeHref(href) ? all : text));
  // Lo que la expresión de arriba no agarra (paréntesis adentro del destino): el esquema peligroso se va.
  s = s.replace(/\]\(\s*<?\s*([A-Za-z][A-Za-z0-9+.-]*):/g, (all, scheme: string) =>
    ['http', 'https', 'mailto'].includes(scheme.toLowerCase()) ? all : '](',
  );
  s = s.replace(REF_DEF, (all, head: string, href: string, rest: string) => (safeHref(href.replace(/^<|>$/g, '')) ? `${head}${href}${rest}` : ''));
  return s.trim().slice(0, max);
}

/**
 * El markdown como texto plano (avisos por email, la línea de vista previa
 * del timeline, la actividad reciente): sin marcas de formato.
 */
export function noteMarkdownToText(markdown: string): string {
  return String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^```.*$/gm, '')
    .replace(/^\s*\+\+\+\s*/gm, '')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}>\s?(\[![A-Z]+\]\s*)?/gm, '')
    .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/gm, '$1- ')
    .replace(/^(\s*)[*+]\s+/gm, '$1- ')
    .replace(/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(INLINE_LINK, (_all, _bang: string, text: string) => text)
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1$2')
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto plano del cuerpo de una actividad, según su formato. */
export function activityBodyText(a: { body: string; body_format?: string | null }): string {
  return a.body_format === 'md' ? noteMarkdownToText(a.body) : a.body;
}

/**
 * Texto plano → markdown que se lee igual (para abrir una nota de antes en el
 * editor con formato): escapa lo que el markdown tomaría como marca. Un `_`
 * dentro de una palabra o un email no se toca (las @menciones por email
 * siguen avisando).
 */
export function plainToMarkdown(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/[\\`*[\]<>~|]/g, (c) => `\\${c}`)
        .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'))
        .replace(/^(\s*)([#+-])(?=\s|$)/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])(?=\s|$)/, '$1\\$2'),
    )
    .join('\n');
}
