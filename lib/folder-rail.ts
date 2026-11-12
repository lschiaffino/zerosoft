/** Iniciales y tono de las carpetas del sidebar colapsado (components/ui/FolderRail.tsx). */

/** Hasta dos letras: iniciales de las dos primeras palabras, o las dos primeras letras. */
export function folderInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '·';
  const first = Array.from(words[0]);
  const second = words[1] ? Array.from(words[1])[0] : first[1];
  return (first[0] + (second ?? '')).toUpperCase();
}

/** Tono estable por nombre (para carpetas sin color). */
export function folderHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}
