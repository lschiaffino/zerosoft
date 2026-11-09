/**
 * Inbox con la cara de WhatsApp: nombres para mostrar, teléfonos y la vista
 * previa de la lista. Puro (lo usan la interfaz y los tests).
 */

/** "5491155550000" → "+54 9 11 5555-0000" (Argentina) o "+1 555 000 1001"; otros países: "+" y grupos de a 3/4. */
export function formatPhone(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  const ar = /^549(11|\d{3})(\d{3,4})(\d{4})$/.exec(d);
  if (ar) return `+54 9 ${ar[1]} ${ar[2]}-${ar[3]}`;
  const us = /^1(\d{3})(\d{3})(\d{4})$/.exec(d);
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`;
  return `+${d}`;
}

/** Nombre del chat como lo muestra WhatsApp: el nombre, o el teléfono con formato, o "Grupo". */
export function chatName(th: { title: string; handle: string; kind: string; channel?: string }, groupLabel: string): string {
  const title = (th.title ?? '').trim();
  if (th.channel === 'gmail') return title || th.handle;
  if (title && title !== th.handle && !/^\d{6,}(-\d+)?$/.test(title)) return title;
  if (th.kind === 'group') return groupLabel;
  return formatPhone(th.handle || title) || title;
}

/** Nombre de quien mandó un mensaje en un grupo: nombre, o teléfono con formato. */
export function senderLabel(name: string, handle: string): string {
  const n = (name ?? '').trim();
  return n || formatPhone(handle) || '';
}

/** La vista previa guarda "[image]" cuando no hay texto: eso no es texto para mostrar. */
export function previewText(preview: string): string {
  const p = (preview ?? '').trim();
  return /^\[[a-z]+\]$/.test(p) ? '' : p;
}

/** Tipo de la vista previa para el ícono ('' = texto). */
export type PreviewKind = '' | 'image' | 'video' | 'voice' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'poll';

export function previewKind(kind: string, preview: string): PreviewKind {
  const k = (kind ?? '').toLowerCase();
  if (['image', 'video', 'voice', 'audio', 'document', 'sticker', 'location', 'contact', 'poll'].includes(k)) return k as PreviewKind;
  const m = /^\[([a-z]+)\]$/.exec((preview ?? '').trim());
  if (m && ['image', 'video', 'audio', 'document', 'sticker'].includes(m[1])) return m[1] as PreviewKind;
  return '';
}

/** Agrupa las reacciones por emoji (como el globito de WhatsApp): el más usado primero. */
export function groupReactions(list: Array<{ emoji: string; by: string; name: string }>): Array<{ emoji: string; count: number; mine: boolean; names: string[] }> {
  const map = new Map<string, { emoji: string; count: number; mine: boolean; names: string[] }>();
  for (const r of list) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
    g.count++;
    if (r.by === 'me') g.mine = true;
    else if (r.name || r.by) g.names.push(r.name || formatPhone(r.by));
    map.set(r.emoji, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
