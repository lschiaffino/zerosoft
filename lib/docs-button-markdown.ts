/**
 * Atajos que la gente escribe en el Markdown de un bloque botón y que el
 * Markdown estricto no entiende: `[] tarea`, `[ ] tarea`, `[x] hecha` (sin el
 * guion de lista) o `- [] tarea` (sin el espacio entre corchetes). Se pasan a
 * la forma GFM (`- [ ] tarea`) antes de convertir a bloques, como hace Notion
 * al tipear `[]`. Quedan como están las líneas dentro de un bloque de código,
 * los links (`[x](url)`, `[x]: url`) y unos corchetes sin texto detrás.
 */
const TODO_SHORTHAND = /^(\s*)(?:[-*+]\s+|-)?\[(\s?|[xX])\](?![(:])\s*(\S.*)$/;

export function expandButtonShorthand(md: string): string {
  let fence: string | null = null;
  return md
    .split('\n')
    .map((line) => {
      const f = /^\s*(```|~~~)/.exec(line);
      if (f) {
        if (fence === null) fence = f[1];
        else if (fence === f[1]) fence = null;
        return line;
      }
      if (fence !== null) return line;
      const m = TODO_SHORTHAND.exec(line);
      if (!m) return line;
      const [, indent, mark, text] = m;
      return `${indent}- [${mark.trim() ? 'x' : ' '}] ${text}`;
    })
    .join('\n');
}
