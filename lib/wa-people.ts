/**
 * Contactos de WhatsApp como una base: cada persona una sola vez aunque
 * aparezca en varias líneas (Lines) o cuentas (Inbox), como chat 1:1 o como
 * miembro de grupos, por teléfono o solo por su lid (el id anónimo de
 * WhatsApp). Lo usan lib/groups-contacts.ts e lib/inbox/contacts.ts; acá
 * está lo puro: juntar las apariciones de una persona y armar su fila.
 *
 * La identidad de una persona es su teléfono si se conoce (directo o por la
 * libreta, que sabe qué lid es de qué teléfono); si no, su lid ("lid:<dígitos>").
 * Hacia la interfaz nunca sale la identidad: sale un id opaco (personId) que
 * no deja leer el teléfono a quien lo tiene oculto.
 */
import { createHash } from 'crypto';

/** Dónde aparece una persona. */
export interface PersonSighting {
  phone: string;
  lid: string;
  /** Línea (Lines) o cuenta (Inbox). */
  accountId: string;
  kind: 'dm' | 'member';
  chatId: string;
  /** El grupo como uno solo entre líneas (su JID); para un 1:1, el id del chat. */
  groupKey: string;
  chatName: string;
  /** Nombre de la persona en ese chat (el del 1:1 o el de miembro). */
  name: string;
  /** Último mensaje del 1:1 o último que mandó en el grupo. */
  at: string | null;
}

/** Lo que sabe la libreta de una persona (wa_contacts). */
export interface BookEntry {
  phone: string;
  lid: string;
  saved: string;
  push: string;
  picture?: string;
}

export interface PersonGroup {
  key: string;
  /** Un chat del grupo que quien mira ve (el más reciente). */
  chatId: string;
  name: string;
  accountIds: string[];
}

export interface PersonChat {
  chatId: string;
  accountId: string;
  at: string | null;
}

export interface Person {
  /** Teléfono o "lid:<dígitos>". Solo del lado del servidor. */
  identity: string;
  phone: string;
  lid: string;
  name: string;
  picture: string;
  accountIds: string[];
  groups: PersonGroup[];
  dms: PersonChat[];
  lastAt: string | null;
}

const PHONE_RE = /^\d{8,15}$/;
const LID_RE = /^\d{5,20}$/;

export function cleanDigits(raw: unknown): string {
  return String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');
}

/** Un nombre que es un número (o el genérico de un lid) no nombra a nadie. */
export function realName(raw: unknown, generic: readonly string[] = []): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!s || /^\+?[\d\s().-]{5,}$/.test(s) || generic.includes(s)) return '';
  return s.slice(0, 120);
}

/** Id opaco de una persona para la interfaz y las URLs (no deja ver el teléfono). */
export function personId(scope: string, identity: string): string {
  return createHash('sha256').update(`wa-person\n${scope}\n${identity}`).digest('hex').slice(0, 24);
}

export function isPersonId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
}

const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : b > a ? b : a);

/**
 * Junta las apariciones por persona. `book`: pares lid ↔ teléfono y nombres de
 * la libreta. `skip`: teléfonos que no son contactos (las propias líneas o cuentas).
 * Orden de salida: último mensaje más reciente primero, después por nombre.
 */
export function mergePeople(sightings: PersonSighting[], book: BookEntry[], skip: Iterable<string> = [], generic: readonly string[] = []): Person[] {
  const lidPhone = new Map<string, string>();
  const bookBy = new Map<string, BookEntry>();
  for (const b of book) {
    const phone = cleanDigits(b.phone);
    const lid = cleanDigits(b.lid);
    if (PHONE_RE.test(phone) && LID_RE.test(lid) && !lidPhone.has(lid)) lidPhone.set(lid, phone);
    if (PHONE_RE.test(phone) && !bookBy.has(phone)) bookBy.set(phone, b);
    if (LID_RE.test(lid) && !bookBy.has(`lid:${lid}`)) bookBy.set(`lid:${lid}`, b);
  }
  const skipSet = new Set([...skip].map(cleanDigits).filter(Boolean));
  type Acc = {
    identity: string;
    phone: string;
    lid: string;
    dmName: string;
    memberName: string;
    accounts: Set<string>;
    groups: Map<string, PersonGroup & { at: string | null }>;
    dms: PersonChat[];
    lastAt: string | null;
  };
  const people = new Map<string, Acc>();
  for (const s of sightings) {
    const lid = LID_RE.test(cleanDigits(s.lid)) ? cleanDigits(s.lid) : '';
    let phone = PHONE_RE.test(cleanDigits(s.phone)) ? cleanDigits(s.phone) : '';
    if (!phone && lid) phone = lidPhone.get(lid) ?? '';
    if (!phone && !lid) continue;
    if (phone && skipSet.has(phone)) continue;
    const identity = phone || `lid:${lid}`;
    let p = people.get(identity);
    if (!p) {
      p = { identity, phone, lid, dmName: '', memberName: '', accounts: new Set(), groups: new Map(), dms: [], lastAt: null };
      people.set(identity, p);
    }
    if (!p.lid && lid) p.lid = lid;
    p.accounts.add(s.accountId);
    p.lastAt = later(p.lastAt, s.at);
    const name = realName(s.name, generic);
    if (s.kind === 'dm') {
      if (name && !p.dmName) p.dmName = name;
      if (!p.dms.some((d) => d.chatId === s.chatId)) p.dms.push({ chatId: s.chatId, accountId: s.accountId, at: s.at });
    } else {
      if (name && !p.memberName) p.memberName = name;
      const g = p.groups.get(s.groupKey);
      if (!g) p.groups.set(s.groupKey, { key: s.groupKey, chatId: s.chatId, name: s.chatName, accountIds: [s.accountId], at: s.at });
      else {
        if (!g.accountIds.includes(s.accountId)) g.accountIds.push(s.accountId);
        if (!g.name && s.chatName) g.name = s.chatName;
        if ((s.at ?? '') > (g.at ?? '')) {
          g.chatId = s.chatId;
          g.at = s.at;
        }
      }
    }
  }
  const out: Person[] = [];
  for (const p of people.values()) {
    const b = (p.phone && bookBy.get(p.phone)) || (p.lid && bookBy.get(`lid:${p.lid}`)) || undefined;
    const name = realName(b?.saved, generic) || p.dmName || p.memberName || realName(b?.push, generic);
    out.push({
      identity: p.identity,
      phone: p.phone,
      lid: p.lid,
      name,
      picture: b?.picture ?? '',
      accountIds: [...p.accounts].sort(),
      groups: [...p.groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ at: _at, ...g }) => g),
      dms: p.dms.sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? 1 : (a.at ?? '') > (b.at ?? '') ? -1 : 0)),
      lastAt: p.lastAt,
    });
  }
  return out.sort((a, b) => {
    const x = a.lastAt ?? '';
    const y = b.lastAt ?? '';
    if (x !== y) return x < y ? 1 : -1;
    return (a.name || a.identity).localeCompare(b.name || b.identity);
  });
}

/** Búsqueda en la lista: por nombre (sin acentos) o, si se puede ver el teléfono, por sus dígitos. */
export function personMatches(p: Pick<Person, 'name' | 'phone'>, q: string, canSeePhone: boolean): boolean {
  const query = fold(q.trim());
  if (!query) return true;
  if (fold(p.name).includes(query)) return true;
  const digits = q.replace(/\D/g, '');
  return canSeePhone && digits.length >= 3 && p.phone.includes(digits);
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
