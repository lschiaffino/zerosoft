/**
 * Groups, varias líneas: lo que comparten servidor y navegador (sin base de
 * datos). Colores de línea, estados de disponibilidad y la forma de las
 * líneas por las que se puede responder un chat ("Responder desde").
 */

/** Paleta de las líneas (se ve en claro y oscuro). */
export const LINE_COLORS = ['#2f80ed', '#27ae60', '#e2a03f', '#9b51e0', '#eb5757', '#00a3a3', '#d65db1', '#6b7a8f'] as const;

/** Color de una línea: el elegido o uno fijo según el id (siempre el mismo). */
export function lineColor(line: { id: string; color?: string | null }): string {
  if (line.color && /^#[0-9a-fA-F]{6}$/.test(line.color)) return line.color;
  let h = 0;
  for (const ch of line.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LINE_COLORS[h % LINE_COLORS.length];
}

/** Disponibilidad de una persona. Sin dato = en línea. */
export const AVAILABILITY = ['online', 'away', 'offline'] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** Condición de disponibilidad de una regla de asignación. */
export const RULE_AVAILABILITY = ['online', 'online_away', 'any'] as const;
export type RuleAvailability = (typeof RULE_AVAILABILITY)[number];

export function cleanAvailability(v: unknown): Availability | null {
  return (AVAILABILITY as readonly string[]).includes(String(v)) ? (v as Availability) : null;
}

/** ¿Esta persona entra en la rotación de una regla con esa condición? */
export function availableFor(rule: RuleAvailability, status: Availability | undefined): boolean {
  const s = status ?? 'online';
  if (rule === 'any') return true;
  if (rule === 'online_away') return s !== 'offline';
  return s === 'online';
}

/**
 * Una línea por la que se puede responder un chat. El mismo grupo (o el
 * mismo contacto) en dos líneas de la org es un chat por línea en la base;
 * la bandeja lo muestra una vez y el composer elige por cuál sale.
 */
export interface ReplyLine {
  /** Chat de esa línea ('' si todavía no existe: un 1:1 que nunca habló por esa línea). */
  chatId: string;
  numberId: string;
  name: string;
  phone: string;
  color: string;
  status: 'pending' | 'qr' | 'connected' | 'disconnected' | 'error';
  /** Conectada y la persona la puede usar. */
  canSend: boolean;
  /** La línea del chat que se abrió (la que se usa si no se elige otra). */
  isDefault: boolean;
}

/** Línea elegida por defecto: la guardada si sigue sirviendo, si no la del chat, si no la primera que puede enviar. */
export function pickReplyLine(lines: ReplyLine[], saved?: string | null): ReplyLine | null {
  const usable = lines.filter((l) => l.canSend);
  return usable.find((l) => l.numberId === saved) ?? usable.find((l) => l.isDefault) ?? usable[0] ?? lines.find((l) => l.isDefault) ?? null;
}
