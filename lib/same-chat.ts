/**
 * El mismo chat en varias líneas (Lines) o cuentas de WhatsApp (Inbox).
 *
 * En la base cada línea tiene su propio chat: el mismo grupo en dos líneas son
 * dos filas con el mismo JID; el mismo contacto, dos 1:1 con el mismo teléfono.
 * La bandeja lo muestra una vez (la fila "líder", la que va primero en el orden
 * de la lista), con los no leídos sumados, y el hilo junta los mensajes de
 * todas sin repetidos. Acá va lo puro (sin base), compartido por las dos apps
 * y por el navegador.
 */

/** Una línea por la que existe el chat (para la bandeja, el hilo y "Responder desde"). */
export interface ChatLineRef {
  /** El chat de esa línea. */
  chatId: string;
  /** La línea (Lines: groups_numbers.id; Inbox: inbox_accounts.id). */
  lineId: string;
  /** Nombre visible de la línea. */
  name: string;
  /** Color de la línea (Lines, lib/line-colors.ts); '' o ausente = sin color. */
  color?: string;
  unread: number;
  lastMessageAt: string | null;
  /** La línea salió del grupo o se desconectó: se ve en el hilo pero no se puede responder por ahí. */
  canSend: boolean;
}

/** Clave que une el mismo chat en distintas líneas. '' = no se junta con nada. */
export function sameChatKey(kind: string, phone: string, jid: string): string {
  if (kind === 'group') return jid ? `g|${jid}` : '';
  if (kind === 'dm') return phone ? `p|${phone}` : jid ? `j|${jid}` : '';
  return '';
}

/** Lo que hace falta de cada fila para decidir cuál encabeza su grupo de líneas. */
export interface SameChatRow {
  id: string;
  key: string;
}

/**
 * Deja una fila por clave: la líder, que es la primera en el orden de la
 * lista entre las que cumplen los filtros (`leadByKey`, calculada sobre todas
 * las líneas, también las que no están en esta página). Una fila cuya líder
 * está en otra página (antes) no se repite acá.
 */
export function collapseSameChats<T extends SameChatRow>(rows: T[], leadByKey: Map<string, string>): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.key) return true;
    const lead = leadByKey.get(r.key);
    if (lead && lead !== r.id) return false;
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
}

/**
 * No leídos de la fila unida. En un 1:1 cada línea es otra conversación: se suman. En un grupo cada línea recibe
 * los mismos mensajes: se toma la que más tiene (sumar contaría dos veces lo que llegó a las dos).
 */
export function mergedUnread(kind: string, lines: Array<Pick<ChatLineRef, 'unread'>>): number {
  if (kind === 'group') return lines.reduce((n, l) => Math.max(n, l.unread), 0);
  return lines.reduce((n, l) => n + l.unread, 0);
}

/** La primera según `before` (true si a va antes que b en la lista). */
export function firstBy<T>(list: T[], before: (a: T, b: T) => boolean): T | undefined {
  let best: T | undefined;
  for (const x of list) if (!best || before(x, best)) best = x;
  return best;
}

/**
 * Los mensajes del mismo hilo en varias líneas, sin repetidos: un grupo donde
 * están dos líneas recibe cada mensaje una vez por línea (mismo id de
 * WhatsApp), y lo que manda una línea le llega a la otra como entrante. Queda
 * una copia por id; si una es propia (salió de una línea nuestra), esa.
 * Mantiene el orden de entrada.
 */
export function dedupeLineMessages<T>(list: T[], providerId: (m: T) => string | null | undefined, outgoing: (m: T) => boolean): T[] {
  const pick = new Map<string, T>();
  const idOf = (m: T) => waKeyId(providerId(m));
  for (const m of list) {
    const pid = idOf(m);
    if (!pid) continue;
    const prev = pick.get(pid);
    if (!prev || (!outgoing(prev) && outgoing(m))) pick.set(pid, m);
  }
  return list.filter((m) => {
    const pid = idOf(m);
    return !pid || pick.get(pid) === m;
  });
}

/**
 * El id del mensaje en WhatsApp (key.id), igual en todas las líneas. Algunos
 * proveedores lo guardan compuesto ("false_<chat>@g.us_<id>_<autor>@c.us"):
 * de ahí sale la parte que no es el chat, el autor ni la dirección.
 */
export function waKeyId(raw: string | null | undefined): string {
  const id = (raw ?? '').trim();
  if (!id.includes('_') || !id.includes('@')) return id;
  const parts = id.split('_').filter((p) => p && p !== 'true' && p !== 'false' && !p.includes('@'));
  return parts.length === 1 ? parts[0] : id;
}

/**
 * Línea por defecto para responder: la del último mensaje que entró o salió
 * (si todavía se puede usar), si no la del chat abierto, si no la primera
 * que puede mandar.
 */
export function defaultReplyLine(lines: ChatLineRef[], lastChatId: string | null | undefined, openChatId: string): ChatLineRef | null {
  const usable = lines.filter((l) => l.canSend);
  return usable.find((l) => l.chatId === lastChatId) ?? usable.find((l) => l.chatId === openChatId) ?? usable[0] ?? null;
}
