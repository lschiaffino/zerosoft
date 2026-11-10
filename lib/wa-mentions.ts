/**
 * Menciones de WhatsApp ("@<dígitos>" en el texto). WhatsApp escribe en el
 * mensaje los dígitos del id mencionado: un teléfono o, desde los ids
 * anónimos, un lid ("@118571178918100"). Estas funciones son puras (las usan
 * el servidor, la interfaz de Inbox y la de Lines, y los tests): sacan los
 * dígitos candidatos de un texto y lo parten en pedazos de texto y menciones
 * con el nombre para mostrar.
 */

/** Lo que se sabe de un id mencionado: nombre (si hay) y teléfono (si hay). */
export interface MentionTarget {
  name: string;
  phone: string;
}

/** Ids mencionados → a quién son (lo arma el servidor para cada página de mensajes). */
export type MentionMap = Record<string, MentionTarget>;

const MENTION_RE = /(^|[^\w@])@(\d{5,20})(?!\d)/g;

/** Dígitos que aparecen como "@<dígitos>" en el texto, sin repetir. */
export function mentionDigits(text: string): string[] {
  const out: string[] = [];
  if (!text || !text.includes('@')) return out;
  for (const m of text.matchAll(MENTION_RE)) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

/**
 * Ids a resolver de una tanda de mensajes: los guardados como mencionados
 * (dígitos de un teléfono, o "<dígitos>@lid" para un lid)
 * en contextInfo.mentionedJid, y los "@<dígitos>" del texto (mensajes viejos,
 * de antes de guardar las menciones). Con tope, para no armar consultas enormes.
 */
export function mentionCandidates(items: Array<{ body: string; mentions?: unknown }>, max = 400): string[] {
  const out = new Set<string>();
  for (const it of items) {
    if (Array.isArray(it.mentions)) {
      for (const raw of it.mentions) {
        const d = typeof raw === 'string' ? raw.replace(/@lid$/i, '') : '';
        if (/^\d{5,20}$/.test(d)) out.add(d);
      }
    }
    for (const d of mentionDigits(it.body)) out.add(d);
    if (out.size >= max) break;
  }
  return [...out].slice(0, max);
}

/** Etiqueta de la mención: el nombre o, si solo se sabe el teléfono, el teléfono con formato. '' si no se sabe nada. */
export function mentionLabel(target: MentionTarget | undefined, formatPhone: (digits: string) => string): string {
  if (!target) return '';
  const name = (target.name ?? '').trim();
  if (name) return name;
  return target.phone ? formatPhone(target.phone) : '';
}

export type MentionPart = string | { mention: string; label: string };

/**
 * Parte un texto en pedazos de texto y menciones conocidas ("@Ana" en lugar
 * de "@5491155550000"). Los "@<dígitos>" que no están en `labels` quedan como
 * texto. `labels`: dígitos → etiqueta ya resuelta.
 */
export function splitMentions(text: string, labels: Record<string, string> | Map<string, string> | undefined): MentionPart[] {
  if (!text) return [];
  const get = (d: string) => (labels instanceof Map ? labels.get(d) : labels?.[d]) ?? '';
  if (!labels || (labels instanceof Map ? labels.size === 0 : Object.keys(labels).length === 0) || !text.includes('@')) return [text];
  const out: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const label = get(m[2]);
    if (!label) continue;
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) out.push(text.slice(last, at));
    out.push({ mention: m[2], label });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

/** El texto con "@Nombre" en lugar de "@<dígitos>" (vista previa, citas, copiar). */
export function replaceMentions(text: string, labels: Record<string, string> | Map<string, string> | undefined): string {
  return splitMentions(text, labels)
    .map((p) => (typeof p === 'string' ? p : `@${p.label}`))
    .join('');
}
