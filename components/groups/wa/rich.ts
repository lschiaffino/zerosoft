/**
 * Formato de WhatsApp (*negrita*, _cursiva_, ~tachado~, ```mono``` y `código`)
 * a nodos puros (para RichText y los tests). Nunca HTML.
 *
 * Reglas como en WhatsApp: el marcador abre al principio o después de un
 * espacio o signo, y cierra antes de un espacio, signo o el final; el texto de
 * adentro no puede empezar ni terminar con espacio.
 */
export type Kind = 'b' | 'i' | 's' | 'code';
const MARKS: Array<{ ch: string; kind: Kind }> = [
  { ch: '*', kind: 'b' },
  { ch: '_', kind: 'i' },
  { ch: '~', kind: 's' },
  { ch: '`', kind: 'code' },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Partes del texto (puro, para tests): texto suelto o un tramo con formato. */
export type WaNode = string | { kind: Kind | 'pre'; children: WaNode[] };

export function parseWa(text: string, depth = 0): WaNode[] {
  if (!text) return [];
  // Bloques ```...``` primero (adentro no hay más formato).
  if (depth === 0 && text.includes('```')) {
    const out: WaNode[] = [];
    const re = /```([\s\S]+?)```/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) out.push(...parseWa(text.slice(last, m.index), 1));
      out.push({ kind: 'pre', children: [m[1]] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(...parseWa(text.slice(last), 1));
    return out;
  }
  if (depth > 4) return [text];
  let best: { start: number; end: number; inner: string; kind: Kind } | null = null;
  for (const { ch, kind } of MARKS) {
    const c = escapeRe(ch);
    const re = new RegExp(`(^|[\\s([{"'¿¡.,;:!?\\-])${c}([^\\s${c}](?:[^${c}\\n]*?[^\\s${c}])?)${c}(?=$|[\\s)\\]}"'.,;:!?\\-])`, 'g');
    const m = re.exec(text);
    if (m) {
      const start = m.index + m[1].length;
      if (!best || start < best.start) best = { start, end: start + m[2].length + 2, inner: m[2], kind };
    }
  }
  if (!best) return [text];
  const out: WaNode[] = [];
  if (best.start > 0) out.push(text.slice(0, best.start));
  out.push({ kind: best.kind, children: best.kind === 'code' ? [best.inner] : parseWa(best.inner, depth + 1) });
  out.push(...parseWa(text.slice(best.end), Math.max(depth, 1)));
  return out;
}

