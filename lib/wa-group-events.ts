/**
 * Avisos de sistema de los grupos de WhatsApp (Inbox y Lines): "Creaste el
 * grupo", "Ana te agregó", "Beto salió", "Ana agregó a Beto", "Ana ahora es
 * admin". Se guardan como filas de sistema en el chat (no cuentan como no
 * leídos) y el último sirve de vista previa de la lista, como en WhatsApp.
 * Puro: lo usan el servidor, la pantalla y los tests.
 *
 * De dónde salen (Evolution 2.3.7, leído del código fuente, sin payloads
 * reales a la vista):
 * - GROUPS_UPSERT: Baileys lo emite con la metadata del grupo cuando se crea
 *   un grupo en el que está la cuenta (lo creó ella desde el teléfono u otra
 *   persona la incluyó al crearlo). Trae `owner`/`author` y `creation`.
 * - GROUP_PARTICIPANTS_UPDATE: add/remove/promote/demote con `author` (quién
 *   lo hizo) y `participantsData` (teléfonos resueltos). "Salió" es un remove
 *   de uno mismo; "se unió con el link" es un add sin autor o de uno mismo.
 * - Los "stubs" (messageStubType GROUP_CREATE, GROUP_PARTICIPANT_LEAVE…) no
 *   llegan: Evolution los descarta en messages.upsert y en el historial porque
 *   no traen `message`. Por eso lo anterior a este cambio no se puede rearmar.
 * - Cambios de asunto, descripción o foto: Evolution emite `groups.update`,
 *   pero su filtro de webhooks compara GROUPS_UPDATE contra la opción
 *   GROUP_UPDATE y nunca coincide, y la foto solo llega como stub. El parche
 *   0008 de infra/evolution arregla las dos cosas (la foto sale como
 *   groups.update con `picture`). Lo hecho desde zerosoft (Lines) se anota
 *   también al hacerlo.
 */

export const WA_GROUP_EVENT_TYPES = ['create', 'add', 'remove', 'leave', 'join', 'promote', 'demote', 'subject', 'description', 'icon'] as const;
export type WaGroupEventType = (typeof WA_GROUP_EVENT_TYPES)[number];

/** Una persona del aviso: `p` son los dígitos del teléfono (o "<dígitos>@lid"), o "me"; `n`, el nombre si se conoce. */
export interface WaGroupPerson {
  p: string;
  n?: string;
}

export interface WaGroupEvent {
  t: WaGroupEventType;
  /** Quién lo hizo ("me" si fue la cuenta); vacío si no se sabe. */
  by?: WaGroupPerson;
  /** A quién (agregados, sacados, admins). */
  who?: WaGroupPerson[];
  /** Asunto del grupo (al crearlo o al cambiarlo). */
  subject?: string;
}

/** Marca de la vista previa de la lista cuando lo último del chat es un aviso de sistema. */
export const SYS_PREVIEW = '[sys]';

const isMe = (p: WaGroupPerson | undefined) => p?.p === 'me';

/** Vista previa guardada en la lista (inbox_threads.preview, groups_chats.last_message_preview). */
export function encodeSysPreview(e: WaGroupEvent): string {
  return `${SYS_PREVIEW}${JSON.stringify(cleanEvent(e))}`;
}

/** El aviso de una vista previa guardada, o null si no es un aviso. */
export function decodeSysPreview(preview: string | null | undefined): WaGroupEvent | null {
  const s = String(preview ?? '');
  if (!s.startsWith(SYS_PREVIEW)) return null;
  try {
    return parseEvent(JSON.parse(s.slice(SYS_PREVIEW.length)));
  } catch {
    return null;
  }
}

/** Lee un aviso guardado (meta de la fila) sin confiar en su forma. */
export function parseEvent(raw: unknown): WaGroupEvent | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.t !== 'string' || !(WA_GROUP_EVENT_TYPES as readonly string[]).includes(o.t)) return null;
  const person = (v: unknown): WaGroupPerson | null => {
    const x = (v ?? {}) as Record<string, unknown>;
    if (typeof x.p !== 'string' || !x.p) return null;
    return { p: x.p.slice(0, 40), ...(typeof x.n === 'string' && x.n ? { n: x.n.slice(0, 120) } : {}) };
  };
  const by = person(o.by);
  const who = Array.isArray(o.who) ? o.who.map(person).filter((x): x is WaGroupPerson => !!x).slice(0, 50) : [];
  return {
    t: o.t as WaGroupEventType,
    ...(by ? { by } : {}),
    ...(who.length ? { who } : {}),
    ...(typeof o.subject === 'string' && o.subject ? { subject: o.subject.slice(0, 200) } : {}),
  };
}

function cleanEvent(e: WaGroupEvent): WaGroupEvent {
  return parseEvent(e) ?? { t: e.t };
}

/**
 * ¿El aviso sube el chat al tope de la lista? Solo crear el grupo y que me
 * agreguen (o entrar con el link): es cuando el grupo aparece para mí. El
 * resto queda como vista previa si es lo último, sin mover el chat.
 */
export function bumpsChat(e: WaGroupEvent): boolean {
  if (e.t === 'create') return true;
  if (e.t === 'add' || e.t === 'join') return (e.who ?? []).some(isMe) || (e.t === 'join' && isMe(e.by));
  return false;
}

/**
 * Id del aviso en el chat (único por chat): repetir el mismo evento (el
 * reintento de un webhook, el eco de lo que hicimos desde zerosoft) no lo
 * duplica. Crear es uno por grupo. El resto no trae id del proveedor: tipo,
 * personas y el minuto en que pasó. Lleva el id del grupo (en Lines el id
 * del proveedor es único por número, no por chat).
 */
export function groupEventId(e: WaGroupEvent, at: string, chatId: string): string {
  const chat = chatId.replace(/@.*$/, '');
  if (e.t === 'create') return `sys:create:${chat}`;
  const minute = String(at).slice(0, 16);
  const who = (e.who ?? []).map((w) => w.p).sort().join(',');
  const extra = e.t === 'subject' || e.t === 'description' ? `:${simpleHash(e.subject ?? '')}` : '';
  return `sys:${e.t}:${chat}:${e.by?.p ?? ''}:${who}:${minute}${extra}`.slice(0, 280);
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Un participante del aviso: "me" si es la cuenta. */
export function personOf(id: string, myPhone: string): WaGroupPerson {
  const digits = id.replace(/@.*$/, '').replace(/\D/g, '');
  if (myPhone && digits && digits === myPhone && !/@lid$/.test(id)) return { p: 'me' };
  return { p: /@lid$/.test(id) ? `${digits}@lid` : digits };
}

/**
 * Un cambio de participantes de WhatsApp → el aviso. `author`: quién lo hizo
 * (teléfono, "<dígitos>@lid" o vacío). Remove de uno mismo = salió; add sin
 * autor o de uno mismo = se unió con el link de invitación.
 */
export function participantsEvent(action: 'add' | 'remove' | 'promote' | 'demote', phones: string[], author: string, myPhone: string): WaGroupEvent | null {
  const who = [...new Set(phones.filter(Boolean))].map((p) => personOf(p, myPhone));
  if (!who.length) return null;
  const by = author ? personOf(author, myPhone) : null;
  const self = by && who.length === 1 && who[0].p === by.p;
  if (action === 'remove' && self) return { t: 'leave', by };
  if (action === 'add' && (!by || self)) return { t: 'join', by: who[0], ...(who.length > 1 ? { who } : {}) };
  return { t: action, ...(by ? { by } : {}), who };
}

/** Texto del aviso: clave de traducción (groups.wa.events.*) y valores. `name`: cómo nombrar a una persona. */
export function groupEventMessage(e: WaGroupEvent, name: (p: WaGroupPerson) => string): { key: string; values: Record<string, string> } {
  const byMe = isMe(e.by);
  const by = e.by && !byMe ? name(e.by) : '';
  const who = e.who ?? [];
  const meIn = who.some(isMe);
  const others = who.filter((w) => !isMe(w)).map(name).join(', ');
  const subject = e.subject ?? '';
  const pick = (mine: string, theirs: string, unknown: string) => (byMe ? mine : by ? theirs : unknown);
  switch (e.t) {
    case 'create':
      return subject ? { key: pick('createdMe', 'created', 'createdUnknown'), values: { by, subject } } : { key: pick('createdMeNoName', 'createdNoName', 'createdUnknownNoName'), values: { by } };
    case 'add':
      if (meIn && !byMe) return { key: by ? 'addedYou' : 'addedYouUnknown', values: { by } };
      return { key: pick('addedMe', 'added', 'addedUnknown'), values: { by, who: others } };
    case 'remove':
      if (meIn && !byMe) return { key: by ? 'removedYou' : 'removedYouUnknown', values: { by } };
      return { key: pick('removedMe', 'removed', 'removedUnknown'), values: { by, who: others } };
    case 'leave':
      return byMe ? { key: 'leftMe', values: {} } : { key: 'left', values: { who: by } };
    case 'join':
      return byMe ? { key: 'joinedMe', values: {} } : { key: 'joined', values: { who: by } };
    case 'promote':
      if (meIn) return { key: 'promotedYou', values: {} };
      return { key: 'promoted', values: { who: others } };
    case 'demote':
      if (meIn) return { key: 'demotedYou', values: {} };
      return { key: 'demoted', values: { who: others } };
    case 'subject':
      return { key: pick('subjectMe', 'subject', 'subjectUnknown'), values: { by, subject } };
    case 'description':
      return { key: pick('descriptionMe', 'description', 'descriptionUnknown'), values: { by } };
    case 'icon':
      return { key: pick('iconMe', 'icon', 'iconUnknown'), values: { by } };
  }
}

/** Nombre para mostrar de una persona del aviso: su nombre, el teléfono con "+", o "alguien" para un lid sin nombre. */
export function personLabel(p: WaGroupPerson, someone: string, formatPhone: (digits: string) => string = (d) => `+${d}`): string {
  if (p.n) return p.n;
  if (/@lid$/.test(p.p) || !/^\d{5,20}$/.test(p.p)) return someone;
  return formatPhone(p.p);
}
