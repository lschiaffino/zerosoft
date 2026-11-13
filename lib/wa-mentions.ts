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

/** Dígitos más largos que un teléfono habitual: un lid. */
const LID_SHAPED = /^\d{14,20}$/;

/**
 * Ids de un mensaje que son menciones seguro y nunca se muestran como dígitos:
 * los guardados como "<dígitos>@lid" en la lista de mencionados. Sin lista
 * guardada (mensajes viejos, vistas previas que solo tienen el texto), los
 * "@<dígitos>" del texto con forma de lid. Un "@12345" escrito a mano, o un
 * número que la lista guardada no trae, no entra: queda como se escribió.
 */
export function hiddenMentions(item: { body: string; mentions?: unknown }): string[] {
  const out: string[] = [];
  if (Array.isArray(item.mentions) && item.mentions.length) {
    for (const raw of item.mentions) {
      const d = typeof raw === 'string' && /@lid$/i.test(raw) ? raw.replace(/@lid$/i, '') : '';
      if (/^\d{5,20}$/.test(d) && !out.includes(d)) out.push(d);
    }
    return out;
  }
  return mentionDigits(item.body).filter((d) => LID_SHAPED.test(d));
}

/**
 * Las menciones de un mensaje dentro de lo resuelto para toda la tanda. Una
 * entrada sin nombre ni teléfono ("alguien") solo vale para el mensaje que la
 * trae como mención.
 */
export function ownMentions(map: MentionMap, item: { body: string; mentions?: unknown }): MentionMap {
  const own: MentionMap = {};
  let hidden: string[] | null = null;
  const stored = Array.isArray(item.mentions) && item.mentions.length ? (item.mentions as unknown[]) : null;
  for (const d of mentionCandidates([item])) {
    const t = map[d];
    if (!t) continue;
    if (!t.name && !t.phone) {
      hidden ??= hiddenMentions(item);
      if (!hidden.includes(d)) continue;
    }
    // Un teléfono sin nombre que otro mensaje mencionó y la lista guardada de este no trae: acá es texto.
    if (!t.name && t.phone === d && stored && !stored.includes(d)) continue;
    own[d] = t;
  }
  return own;
}

/** "Alguien" para una mención que no se sabe de quién es, donde el texto lo arma el servidor (vistas previas, avisos, export). */
const SOMEONE: Record<string, string> = { en: 'someone', es: 'alguien', pt: 'alguém' };

export function mentionSomeone(locale: string | null | undefined): string {
  return SOMEONE[String(locale ?? '').slice(0, 2).toLowerCase()] ?? SOMEONE.en;
}

/** "Vos" para una mención a la cuenta misma, como la burbuja de Inbox (inboxWa.you). */
const YOU: Record<string, string> = { en: 'You', es: 'Vos', pt: 'Você' };

export function mentionYou(locale: string | null | undefined): string {
  return YOU[String(locale ?? '').slice(0, 2).toLowerCase()] ?? YOU.en;
}

/**
 * Etiqueta de la mención: el nombre o, si solo se sabe el teléfono, el
 * teléfono con formato. Una mención de la que no se sabe nada (un lid sin
 * resolver) lleva `someone` ("alguien"), nunca los dígitos. '' si no hay nada.
 */
export function mentionLabel(target: MentionTarget | undefined, formatPhone: (digits: string) => string, someone = ''): string {
  if (!target) return '';
  const name = (target.name ?? '').trim();
  if (name) return name;
  return target.phone ? formatPhone(target.phone) : someone;
}

/**
 * Etiquetas para mostrar las menciones de un mensaje: primero `base` (los
 * participantes del chat, por teléfono) y después lo que resolvió el servidor
 * (también lids). Si el servidor solo sabe el teléfono y ese teléfono es de
 * un participante con nombre, va el nombre.
 */
export function mentionLabels(
  base: Record<string, string>,
  names: MentionMap | undefined,
  formatPhone: (digits: string) => string,
  someone = '',
): Record<string, string> {
  if (!names) return base;
  const out: Record<string, string> = { ...base };
  for (const [d, target] of Object.entries(names)) {
    if (out[d]) continue;
    // Solo un teléfono entero: uno enmascarado ("54 ••• 00") no identifica a nadie.
    const label = (!target.name?.trim() && /^\d{8,15}$/.test(target.phone ?? '') && base[target.phone]) || mentionLabel(target, formatPhone, someone);
    if (label) out[d] = label;
  }
  return out;
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
