/* Medidas del texto de las tarjetas OG (lib/og-card.tsx), sin dependencias para poder probarlas. */

/** Tamaño del título según el largo: entra en tres líneas sin cortarse. */
export function titleSize(title: string): number {
  const n = title.length;
  if (n <= 18) return 104;
  if (n <= 32) return 84;
  if (n <= 52) return 68;
  if (n <= 80) return 56;
  return 46;
}

/** Recorta en palabra completa con "…" (los títulos largos no se cortan a mitad de palabra). */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}
