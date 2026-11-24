/**
 * La línea debajo del nombre de un grupo, como WhatsApp Web: los nombres de
 * los miembros separados por coma (primero los que tienen nombre, después los
 * teléfonos) y "Vos" al final, nunca el número propio. La usan Lines
 * (components/groups/ChatThread.tsx) e Inbox (components/inbox/wa/WaConversation.tsx).
 */

export interface SubtitleMember {
  /** Nombre guardado o de perfil ('' si no hay). */
  name: string;
  /** Teléfono ya formateado para mostrar ('' si la persona no puede ver números). */
  phone: string;
  /** Es la cuenta conectada (la línea o el WhatsApp de la persona). */
  me?: boolean;
}

/** Cuántos nombres entran antes de cortar con "…" (WhatsApp corta por ancho; acá alcanza con un tope). */
export const GROUP_SUBTITLE_MAX = 12;

/**
 * `you`: "Vos" / "You" / "Você". `total`: cuántos miembros tiene el grupo, si
 * se sabe (puede ser más que la lista cargada): con más de los que se
 * muestran, termina en "…". '' si no hay a quién nombrar.
 */
export function groupSubtitle(members: SubtitleMember[], you: string, total = 0, max = GROUP_SUBTITLE_MAX): string {
  const hasMe = members.some((m) => m.me);
  const others = members
    .filter((m) => !m.me)
    .map((m, i) => ({ label: m.name.trim() || m.phone.trim(), named: Boolean(m.name.trim()), i }))
    .filter((m) => m.label)
    // Estable: primero los que tienen nombre, en el orden en que vinieron.
    .sort((a, b) => Number(b.named) - Number(a.named) || a.i - b.i)
    .slice(0, Math.max(0, hasMe ? max - 1 : max))
    .map((m) => m.label);
  const list = hasMe ? [...others, you] : others;
  if (!list.length) return '';
  const known = members.filter((m) => !m.me).length + (hasMe ? 1 : 0);
  const more = Math.max(total, known) > list.length;
  return `${list.join(', ')}${more ? '…' : ''}`;
}
