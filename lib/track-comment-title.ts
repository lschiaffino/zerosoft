/** Primera línea útil de un comentario en markdown, como título de un sub-issue. */
export function titleFromComment(body: string): string {
  const line =
    body
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*+>]|\d+[.)]|#{1,6})\s+/, '').replace(/\[[ xX]\]\s+/, '').replace(/[*_`~]/g, '').trim())
      .find(Boolean) ?? '';
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}
