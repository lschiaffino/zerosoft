/**
 * Parte un texto corrido (la transcripción de un audio) en párrafos para leerlo
 * mejor: respeta los saltos que ya traiga y, dentro de cada bloque, junta
 * oraciones hasta unos `target` caracteres (nunca corta una oración al medio).
 */
export function toParagraphs(text: string, target = 200): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n|\n/)) {
    const clean = block.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (clean.length <= target * 1.3) {
      out.push(clean);
      continue;
    }
    // Oraciones: se corta solo en el espacio después de . ! ? … (así 3.5 o una URL quedan enteros).
    const sentences = clean.split(/(?<=[.!?…]["”»)]?)\s+/).filter(Boolean);
    let cur = '';
    for (const s of sentences) {
      if (cur && cur.length + s.length + 1 > target && cur.length >= target * 0.45) {
        out.push(cur);
        cur = s;
      } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) {
      // Una cola muy corta se suma al párrafo anterior.
      if (out.length && cur.length < target * 0.3) out[out.length - 1] = `${out[out.length - 1]} ${cur}`;
      else out.push(cur);
    }
  }
  return out;
}
