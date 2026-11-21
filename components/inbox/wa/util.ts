/**
 * Inbox con la cara de WhatsApp: nombres para mostrar, teléfonos y la vista
 * previa de la lista. Puro (lo usan la interfaz y los tests).
 */

/**
 * Un teléfono como lo muestra WhatsApp Web (formato internacional): "5491155550000" → "+54 9 11 5555-0000".
 * Los países más comunes de quienes usan zerosoft; el resto queda "+" y los dígitos.
 */
export function formatPhone(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  const ar = /^549(11|\d{3})(\d{3,4})(\d{4})$/.exec(d);
  if (ar) return `+54 9 ${ar[1]} ${ar[2]}-${ar[3]}`;
  const us = /^1(\d{3})(\d{3})(\d{4})$/.exec(d);
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`;
  // México: Ciudad de México, Guadalajara y Monterrey tienen código de 2 dígitos; el resto, de 3.
  const mx = /^52(1?)(55|33|81)(\d{4})(\d{4})$/.exec(d) ?? /^52(1?)(\d{3})(\d{3})(\d{4})$/.exec(d);
  if (mx) return `+52 ${mx[1] ? '1 ' : ''}${mx[2]} ${mx[3]} ${mx[4]}`;
  const cl = /^569(\d{4})(\d{4})$/.exec(d);
  if (cl) return `+56 9 ${cl[1]} ${cl[2]}`;
  const co = /^57(3\d{2})(\d{7})$/.exec(d);
  if (co) return `+57 ${co[1]} ${co[2]}`;
  const uy = /^598(9\d)(\d{3})(\d{3})$/.exec(d);
  if (uy) return `+598 ${uy[1]} ${uy[2]} ${uy[3]}`;
  const es = /^34([67]\d{2})(\d{2})(\d{2})(\d{2})$/.exec(d);
  if (es) return `+34 ${es[1]} ${es[2]} ${es[3]} ${es[4]}`;
  const uk = /^44(7\d{3})(\d{6})$/.exec(d);
  if (uk) return `+44 ${uk[1]} ${uk[2]}`;
  return `+${d}`;
}

/**
 * Un teléfono que viene del servidor: solo dígitos (con o sin "+") va con formato; uno enmascarado
 * ("54 ••• 01", Lines sin permiso para ver números) queda como vino, con el "+" adelante.
 */
export function phoneLabel(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  return /^\+?[\d\s-]+$/.test(v) ? formatPhone(v) : `+${v.replace(/^\+/, '')}`;
}

/** Un nombre que puede ser un teléfono suelto (quien escribió en un grupo sin nombre guardado): el número va con formato. */
export function nameOrPhone(s: string | null | undefined): string {
  const v = String(s ?? '').trim();
  return /^\+?\d{8,15}$/.test(v) ? formatPhone(v) : v;
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
  return nameOrPhone(name) || formatPhone(handle) || '';
}

/** La vista previa guarda "[image]" cuando no hay texto: eso no es texto para mostrar. */
export function previewText(preview: string): string {
  const p = (preview ?? '').trim();
  return /^\[[a-z]+\]$/.test(p) ? '' : p;
}

/** Tipo de la vista previa para el ícono ('' = texto). */
export type PreviewKind = '' | 'image' | 'video' | 'gif' | 'voice' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'poll';

export function previewKind(kind: string, preview: string): PreviewKind {
  const k = (kind ?? '').toLowerCase();
  if (['image', 'video', 'gif', 'voice', 'audio', 'document', 'sticker', 'location', 'contact', 'poll'].includes(k)) return k as PreviewKind;
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

/** Reemplaza "@5491155550000" por "@Ana" cuando se conoce a la persona (menciones en grupos). */
export function withMentions(text: string, names: Map<string, string>): string {
  if (!names.size || !text.includes('@')) return text;
  return text.replace(/@(\d{8,15})\b/g, (all, d: string) => {
    const n = names.get(d);
    return n ? `@${n}` : all;
  });
}

