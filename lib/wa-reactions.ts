/**
 * Quién reaccionó a un mensaje y con qué, como el cuadro que abre WhatsApp
 * Web al tocar las reacciones: el título con el total, una pestaña por emoji
 * (y "Todas" si hay más de uno) y la lista de personas con su foto, nombre y
 * teléfono. Lo comparten Inbox (lib/inbox/wa-meta.ts reactionDetails) y
 * Lines (lib/groups-person.ts reactionDetails); lo dibuja
 * components/groups/wa/Reactions.tsx. Puro: lo usan el servidor, el cliente y
 * los tests.
 */
import { maskPhone } from './groups-mask';

export interface WaReactor {
  /** El mensaje al que es la reacción (en un álbum, la foto). */
  messageId: string;
  emoji: string;
  /** La reacción propia: se muestra como "Tú" y se saca con un clic. */
  me: boolean;
  /** Nombre para mostrar ('' si no se sabe: se muestra el teléfono). */
  name: string;
  /** El nombre es el de perfil de WhatsApp (no está en la libreta): se muestra "~Nombre", como WhatsApp. */
  pushName: boolean;
  /** Dígitos del teléfono, el texto enmascarado si quien mira no ve teléfonos, o '' si no se sabe. */
  phone: string;
  /** El teléfono viene enmascarado (se muestra tal cual). */
  masked?: boolean;
  /** Foto de perfil guardada ('' sin foto: iniciales). */
  picture: string;
  /** Cuándo reaccionó, si se sabe. */
  at?: string;
}

export interface ReactionTab {
  emoji: string;
  count: number;
}

/** Una pestaña por emoji, el más usado primero (con empate, el que apareció antes). */
export function reactionTabs(list: ReadonlyArray<{ emoji: string }>): ReactionTab[] {
  const map = new Map<string, ReactionTab>();
  for (const r of list) {
    if (!r.emoji) continue;
    const tab = map.get(r.emoji) ?? { emoji: r.emoji, count: 0 };
    tab.count++;
    map.set(r.emoji, tab);
  }
  // sort es estable: con la misma cantidad queda el orden de aparición.
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * Orden de la lista: la propia primero (para sacarla rápido, como WhatsApp) y
 * después la más nueva arriba. Sin hora, la que se guardó después va antes.
 */
export function sortReactors<T extends { me: boolean; at?: string }>(list: readonly T[]): T[] {
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (a.r.me !== b.r.me) return a.r.me ? -1 : 1;
      const ta = a.r.at ?? '';
      const tb = b.r.at ?? '';
      if (ta && tb && ta !== tb) return ta < tb ? 1 : -1;
      return b.i - a.i;
    })
    .map((x) => x.r);
}

/** Lo que muestra una pestaña: todas (null) o las de un emoji. */
export function filterReactors<T extends { emoji: string }>(list: readonly T[], emoji: string | null): T[] {
  return emoji ? list.filter((r) => r.emoji === emoji) : [...list];
}

/** Un "nombre" que es un número no nombra a nadie. */
function cleanName(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /^\+?[\d\s().•-]{5,}$/.test(s)) return '';
  return s.slice(0, 120);
}

/**
 * El nombre de quien reaccionó, como WhatsApp: el de la libreta (o uno puesto
 * a mano en la app) tal cual; si no, el de perfil, marcado para mostrarlo con "~".
 */
export function reactorName(input: { saved?: Array<string | null | undefined>; push?: Array<string | null | undefined> }): { name: string; pushName: boolean } {
  for (const s of input.saved ?? []) {
    const n = cleanName(s);
    if (n) return { name: n, pushName: false };
  }
  for (const s of input.push ?? []) {
    const n = cleanName(s);
    if (n) return { name: n, pushName: true };
  }
  return { name: '', pushName: false };
}

/**
 * El teléfono que recibe el cliente: los dígitos, o enmascarado si quien mira
 * no puede ver teléfonos (la misma regla que la ficha de contacto). Lo que no
 * es un teléfono (un lid sin resolver) no se manda.
 */
export function reactorPhone(digits: string, mask: boolean): { phone: string; masked?: true } {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(d)) return { phone: '' };
  return mask ? { phone: maskPhone(d), masked: true } : { phone: d };
}
