/**
 * Info del mensaje de WhatsApp (Lines e Inbox), como el panel de WhatsApp:
 * en un grupo, "Leído por" y "Entregado a" con la hora de cada persona; en un
 * 1:1, "Leído" y "Entregado" con su hora. Puro: lo usan el servidor
 * (lib/wa-receipts-store.ts, lib/groups-receipts.ts, lib/inbox/wa-receipts.ts),
 * el cliente (components/groups/wa/MessageInfo.tsx) y los tests.
 *
 * De dónde salen las horas:
 * - 1:1: la confirmación que manda WhatsApp por el webhook (status delivered /
 *   read, y "escuchado" en un audio) deja su hora en meta.ack del mensaje, en
 *   la misma escritura que las tildes (ackTimes).
 * - wa_message_receipts guarda una fila por persona (grupos).
 * - Grupos: WhatsApp manda una confirmación por persona, que Evolution no
 *   reenvía. Con el parche 0014 de infra/evolution el gateway las guarda y
 *   zerosoft se las pide al abrir la Info (sin webhooks); lo que trae queda
 *   guardado acá también.
 */

export type ReceiptApp = 'lines' | 'inbox';

export interface ReceiptTimes {
  deliveredAt: string | null;
  readAt: string | null;
  playedAt: string | null;
}

export interface ReceiptInput {
  /** Dígitos del teléfono, o `lid:<dígitos>` si no se sabe; '' en un 1:1. */
  participant: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  playedAt?: string | null;
}

/** Lo que devuelve el gateway por persona (ya normalizado por el proveedor). */
export interface GatewayReceipt {
  /** Dígitos del teléfono, si el gateway lo sabe. */
  phone?: string;
  /** Dígitos del lid, si la persona viene por lid. */
  lid?: string;
  deliveredAt?: string;
  readAt?: string;
  playedAt?: string;
}

const EMPTY: ReceiptTimes = { deliveredAt: null, readAt: null, playedAt: null };

/** Una hora válida en ISO, o null. Acepta ISO, 'YYYY-MM-DD HH:MM:SS' (UTC) y segundos o milisegundos Unix. */
export function receiptTime(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let d: Date;
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d{9,13}$/.test(raw))) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else if (typeof raw === 'string') {
    d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  } else return null;
  const t = d.getTime();
  // Antes de 2009 (WhatsApp no existía) o más de un día en el futuro: dato roto.
  if (!Number.isFinite(t) || t < Date.UTC(2009, 0, 1) || t > Date.now() + 86_400_000) return null;
  return d.toISOString();
}

/** La más temprana de dos horas (null no cuenta). */
export function earliest(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = a ? receiptTime(a) : null;
  const y = b ? receiptTime(b) : null;
  if (!x) return y;
  if (!y) return x;
  return y < x ? y : x;
}

/**
 * Suma una confirmación a lo que ya se sabía de esa persona. Cada hora queda
 * con la primera vez: una repetida no cambia nada y una que llega fuera de
 * orden (leído antes que entregado) se guarda igual en su lugar.
 */
export function mergeReceipt(prev: ReceiptTimes | undefined, next: Omit<ReceiptInput, 'participant'>): { times: ReceiptTimes; changed: boolean } {
  const p = prev ?? EMPTY;
  const times: ReceiptTimes = {
    deliveredAt: earliest(p.deliveredAt, next.deliveredAt ?? null),
    readAt: earliest(p.readAt, next.readAt ?? null),
    playedAt: earliest(p.playedAt, next.playedAt ?? null),
  };
  const changed = times.deliveredAt !== (p.deliveredAt ?? null) || times.readAt !== (p.readAt ?? null) || times.playedAt !== (p.playedAt ?? null);
  return { times, changed };
}

/** Junta las confirmaciones de una tanda por persona (las repetidas quedan en una). */
export function collapseReceipts(list: readonly ReceiptInput[]): Map<string, ReceiptTimes> {
  const out = new Map<string, ReceiptTimes>();
  for (const r of list) {
    if (!r || typeof r.participant !== 'string') continue;
    const key = r.participant.slice(0, 40);
    out.set(key, mergeReceipt(out.get(key), r).times);
  }
  return out;
}

/**
 * Lo que se muestra de una persona: quien leyó también recibió, y quien
 * escuchó también leyó (WhatsApp no siempre manda las tres).
 */
export function shownTimes(t: ReceiptTimes): ReceiptTimes {
  const readAt = earliest(t.readAt, t.playedAt);
  return { deliveredAt: earliest(t.deliveredAt, readAt), readAt, playedAt: t.playedAt ? receiptTime(t.playedAt) : null };
}

/** El gateway → la clave de cada persona (teléfono, si no el lid). Sin la propia línea. */
export function gatewayInputs(list: readonly GatewayReceipt[], selfPhone?: string): ReceiptInput[] {
  const self = (selfPhone ?? '').replace(/\D/g, '');
  const out: ReceiptInput[] = [];
  for (const r of list) {
    const phone = (r.phone ?? '').replace(/\D/g, '');
    const lid = (r.lid ?? '').replace(/\D/g, '');
    const participant = /^\d{6,20}$/.test(phone) ? phone : /^\d{6,20}$/.test(lid) ? `lid:${lid}` : '';
    if (!participant || (self && participant === self)) continue;
    const times = { deliveredAt: receiptTime(r.deliveredAt), readAt: receiptTime(r.readAt), playedAt: receiptTime(r.playedAt) };
    if (!times.deliveredAt && !times.readAt && !times.playedAt) continue;
    out.push({ participant, ...times });
  }
  return out;
}

/** Una persona en el panel: nombre, foto y teléfono con las reglas de siempre (lib/wa-reactions.ts), y sus horas. */
export interface WaReceiptPerson extends ReceiptTimes {
  key: string;
  /** Nombre para mostrar ('' si no se sabe: se muestra el teléfono). */
  name: string;
  /** Nombre de perfil de WhatsApp (no está en la libreta): se muestra "~Nombre". */
  pushName: boolean;
  /** Dígitos, el texto enmascarado si quien mira no ve teléfonos, o '' (un lid sin resolver). */
  phone: string;
  masked?: boolean;
  picture: string;
}

export interface WaMessageInfo {
  group: boolean;
  /** Un audio: "Escuchado" aparte de "Leído". */
  voice: boolean;
  /** Estado del mensaje (tildes). */
  status: string;
  sentAt: string;
  /** 1:1: las horas del otro lado (null si no se sabe). */
  deliveredAt: string | null;
  readAt: string | null;
  playedAt: string | null;
  /** Grupos: cada persona que confirmó algo. */
  people: WaReceiptPerson[];
  /** Grupos: el gateway respondió en este momento (la lista es la de WhatsApp). */
  live: boolean;
  /** No hay datos por persona: el gateway no los da y no hay nada guardado. */
  unavailable: boolean;
}

export interface InfoSections {
  played: WaReceiptPerson[];
  read: WaReceiptPerson[];
  delivered: WaReceiptPerson[];
}

const newestFirst = (field: keyof ReceiptTimes) => (a: WaReceiptPerson, b: WaReceiptPerson) => {
  const x = a[field] ?? '';
  const y = b[field] ?? '';
  return x === y ? a.name.localeCompare(b.name) : x < y ? 1 : -1;
};

/**
 * Las secciones del panel de un grupo, como WhatsApp: cada persona va en una
 * sola, la más avanzada ("Escuchado por" solo en un audio; si no, quien
 * escuchó cuenta como leído). Lo más nuevo arriba.
 */
export function infoSections(people: readonly WaReceiptPerson[], voice: boolean): InfoSections {
  const out: InfoSections = { played: [], read: [], delivered: [] };
  for (const raw of people) {
    const p = { ...raw, ...shownTimes(raw) };
    if (voice && p.playedAt) out.played.push(p);
    else if (p.readAt) out.read.push(p);
    else if (p.deliveredAt) out.delivered.push(p);
  }
  out.played.sort(newestFirst('playedAt'));
  out.read.sort(newestFirst('readAt'));
  out.delivered.sort(newestFirst('deliveredAt'));
  return out;
}

/**
 * Las horas de un 1:1: las guarda el webhook (status) en meta.ack del mensaje,
 * en la misma escritura que las tildes (`{ ack: { delivered, read, played } }`).
 */
export function ackTimes(meta: string | null | undefined): ReceiptTimes {
  try {
    const m = JSON.parse(meta || '{}') as { ack?: Record<string, unknown> };
    const ack = m && typeof m.ack === 'object' && m.ack ? m.ack : {};
    return { deliveredAt: receiptTime(ack.delivered), readAt: receiptTime(ack.read), playedAt: receiptTime(ack.played) };
  } catch {
    return { deliveredAt: null, readAt: null, playedAt: null };
  }
}

/** La clave de una persona sin el prefijo de lid, y si es un lid. */
export function participantKey(participant: string): { key: string; lid: boolean } {
  return participant.startsWith('lid:') ? { key: participant.slice(4), lid: true } : { key: participant, lid: false };
}

/** Filas que se ven antes de "ver todas" en cada sección. */
export const INFO_ROWS = 7;
