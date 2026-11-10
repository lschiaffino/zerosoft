/**
 * Contactos de WhatsApp por cuenta: Inbox (una cuenta personal) y Lines (un
 * número del equipo). Es la libreta que usan las dos apps para nombrar lo
 * que de otro modo sería un número: chats 1:1 que solo tienen el teléfono,
 * participantes de grupos, remitentes y menciones ("@<dígitos>").
 *
 * Cada fila es una persona: teléfono, lid (el id anónimo de WhatsApp, cuando
 * se conoce) o los dos. Se llena de varias fuentes:
 * - los contactos del servidor de WhatsApp (findContacts) al conectar, en la
 *   importación del historial y en el repaso diario (lib/wa-contacts-refresh.ts);
 * - el nombre de perfil (pushName) de cada mensaje que llega, con el lid de
 *   quien manda cuando WhatsApp lo da;
 * - los participantes de los grupos (findGroupInfos), que traen la
 *   equivalencia lid ↔ teléfono.
 *
 * Nombre para mostrar: el de la libreta del teléfono si el servidor lo da;
 * si no, el de perfil. Al cambiar, se renombran los chats y miembros que
 * tenían el nombre anterior (o ninguno): un nombre puesto a mano queda.
 * Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { mentionCandidates, type MentionMap } from './wa-mentions';

export type WaApp = 'inbox' | 'lines';

/** De quién es la libreta: la cuenta de Inbox o el número de Lines, y su workspace o dueña. */
export interface ContactScope {
  app: WaApp;
  accountId: string;
  userId: string;
}

export interface ContactInput {
  phone?: string;
  lid?: string;
  /** Nombre en la libreta del teléfono (o el de la cuenta de empresa). */
  saved?: string;
  /** Nombre de perfil (pushName). */
  push?: string;
  /** "Info" (estado) del contacto. */
  about?: string;
  pictureUrl?: string;
}

export interface ContactRow {
  id: string;
  app: WaApp;
  account_id: string;
  user_id: string;
  phone: string;
  lid: string;
  saved_name: string;
  push_name: string;
  about: string;
  picture_url: string;
  updated_at: string;
}

/** Un contacto cuyo nombre para mostrar cambió (para renombrar chats y miembros). */
export interface Renamed {
  phone: string;
  lid: string;
  before: string;
  after: string;
}

export function displayName(r: Pick<ContactRow, 'saved_name' | 'push_name'> | undefined | null): string {
  if (!r) return '';
  return (r.saved_name || r.push_name || '').trim();
}

function cleanPhone(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}

function cleanLid(raw: unknown): string {
  const d = String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');
  return d.length >= 5 && d.length <= 20 ? d : '';
}

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  // Un "nombre" que es un número no nombra a nadie.
  if (!s || /^\+?[\d\s().-]{5,}$/.test(s)) return '';
  return s.slice(0, 120);
}

/**
 * Junta los datos de la misma persona dentro de una tanda (varios mensajes de
 * quien escribe mucho son una sola escritura).
 */
export function mergeInputs(items: ContactInput[]): ContactInput[] {
  const out: ContactInput[] = [];
  const byPhone = new Map<string, ContactInput>();
  const byLid = new Map<string, ContactInput>();
  for (const raw of items) {
    const phone = cleanPhone(raw.phone);
    const lid = cleanLid(raw.lid);
    if (!phone && !lid) continue;
    const hit = (phone && byPhone.get(phone)) || (lid && byLid.get(lid)) || null;
    const next: ContactInput = hit ?? {};
    if (phone) next.phone = phone;
    if (lid) next.lid = lid;
    if (cleanName(raw.saved)) next.saved = cleanName(raw.saved);
    if (cleanName(raw.push)) next.push = cleanName(raw.push);
    if (typeof raw.about === 'string') next.about = raw.about;
    if (raw.pictureUrl) next.pictureUrl = raw.pictureUrl;
    if (!hit) out.push(next);
    if (next.phone) byPhone.set(next.phone, next);
    if (next.lid) byLid.set(next.lid, next);
  }
  return out;
}

/**
 * Guarda lo que se sabe de cada contacto (completa, nunca borra un dato con
 * un vacío). Si una fila solo tenía el lid y llega el teléfono (o al revés),
 * se juntan. Devuelve los contactos cuyo nombre para mostrar cambió.
 */
export async function rememberContacts(scope: ContactScope, items: ContactInput[], now = new Date()): Promise<Renamed[]> {
  const db = getDb();
  const at = now.toISOString();
  const renamed: Renamed[] = [];
  for (const it of mergeInputs(items).slice(0, 5000)) {
    const phone = it.phone ?? '';
    const lid = it.lid ?? '';
    try {
      const rows = (await db
        .prepare(
          `SELECT * FROM wa_contacts WHERE app = ? AND account_id = ?
             AND ((? <> '' AND phone = ?) OR (? <> '' AND lid = ?)) LIMIT 4`,
        )
        .all(scope.app, scope.accountId, phone, phone, lid, lid)) as unknown as ContactRow[];
      // La fila principal es la del teléfono; una fila suelta del lid se junta con ella.
      const main = rows.find((r) => phone && r.phone === phone) ?? rows[0];
      const extra = rows.filter((r) => r !== main);
      const base: ContactRow | undefined = main;
      const merged = {
        phone: phone || base?.phone || extra.find((r) => r.phone)?.phone || '',
        lid: lid || base?.lid || extra.find((r) => r.lid)?.lid || '',
        saved_name: it.saved ?? (base?.saved_name || extra.find((r) => r.saved_name)?.saved_name || ''),
        push_name: it.push ?? (base?.push_name || extra.find((r) => r.push_name)?.push_name || ''),
        about: it.about !== undefined ? it.about.slice(0, 1000) : (base?.about ?? ''),
        picture_url: it.pictureUrl ? it.pictureUrl.slice(0, 2000) : (base?.picture_url ?? ''),
      };
      const before = displayName(base ?? extra[0]);
      const after = displayName(merged);
      if (extra.length) {
        await db.prepare(`DELETE FROM wa_contacts WHERE id IN (${extra.map(() => '?').join(',')})`).run(...extra.map((r) => r.id));
      }
      if (base) {
        const same =
          base.phone === merged.phone &&
          base.lid === merged.lid &&
          base.saved_name === merged.saved_name &&
          base.push_name === merged.push_name &&
          base.about === merged.about &&
          base.picture_url === merged.picture_url;
        if (!same) {
          await db
            .prepare('UPDATE wa_contacts SET phone = ?, lid = ?, saved_name = ?, push_name = ?, about = ?, picture_url = ?, updated_at = ? WHERE id = ?')
            .run(merged.phone, merged.lid, merged.saved_name, merged.push_name, merged.about, merged.picture_url, at, base.id);
        }
      } else {
        await db
          .prepare(
            `INSERT INTO wa_contacts (id, app, account_id, user_id, phone, lid, saved_name, push_name, about, picture_url, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .run(`wac_${randomUUID().replace(/-/g, '').slice(0, 20)}`, scope.app, scope.accountId, scope.userId, merged.phone, merged.lid, merged.saved_name, merged.push_name, merged.about, merged.picture_url, at);
      }
      if (after && after !== before) renamed.push({ phone: merged.phone, lid: merged.lid, before, after });
    } catch {
      // Un contacto roto (o dos escrituras a la vez sobre el mismo) no frena el resto.
    }
  }
  return renamed;
}

/** Contactos por dígitos (teléfono o lid): cada fila queda bajo los dos. */
export async function lookupContacts(scope: Pick<ContactScope, 'app' | 'accountId'>, digits: string[]): Promise<Map<string, ContactRow>> {
  const out = new Map<string, ContactRow>();
  const list = [...new Set(digits.filter((d) => /^\d{5,20}$/.test(d)))].slice(0, 2000);
  const db = getDb();
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const marks = chunk.map(() => '?').join(',');
    const rows = (await db
      .prepare(`SELECT * FROM wa_contacts WHERE app = ? AND account_id = ? AND (phone IN (${marks}) OR lid IN (${marks}))`)
      .all(scope.app, scope.accountId, ...chunk, ...chunk)) as unknown as ContactRow[];
    for (const r of rows) {
      if (r.phone) out.set(r.phone, r);
      if (r.lid) out.set(r.lid, r);
    }
  }
  return out;
}

/** Nombres para mostrar por teléfono ('' si no se conoce). */
export async function namesByPhone(scope: Pick<ContactScope, 'app' | 'accountId'>, phones: string[]): Promise<Map<string, string>> {
  const rows = await lookupContacts(scope, phones);
  const out = new Map<string, string>();
  for (const p of phones) {
    const n = displayName(rows.get(p));
    if (n) out.set(p, n);
  }
  return out;
}

/** El teléfono que corresponde a un lid ('' si no se sabe). */
export async function phoneForLid(scope: Pick<ContactScope, 'app' | 'accountId'>, lid: string): Promise<string> {
  const d = cleanLid(lid);
  if (!d) return '';
  const r = (await getDb().prepare("SELECT phone FROM wa_contacts WHERE app = ? AND account_id = ? AND lid = ? AND phone <> ''").get(scope.app, scope.accountId, d)) as
    | { phone: string }
    | undefined;
  return r?.phone ?? '';
}

/**
 * A quién son las menciones de una tanda de mensajes: dígitos → nombre y
 * teléfono. Un id guardado como mencionado que es un teléfono queda aunque no
 * se conozca el nombre (se muestra el teléfono); un lid desconocido no.
 */
export async function mentionTargets(scope: Pick<ContactScope, 'app' | 'accountId'>, items: Array<{ body: string; mentions?: unknown }>): Promise<MentionMap> {
  const candidates = mentionCandidates(items);
  if (!candidates.length) return {};
  const rows = await lookupContacts(scope, candidates);
  const explicitPhones = new Set<string>();
  for (const it of items) if (Array.isArray(it.mentions)) for (const m of it.mentions) if (typeof m === 'string' && /^\d{8,15}$/.test(m)) explicitPhones.add(m);
  const out: MentionMap = {};
  for (const d of candidates) {
    const r = rows.get(d);
    if (r && (displayName(r) || r.phone)) out[d] = { name: displayName(r), phone: r.phone };
    else if (explicitPhones.has(d)) out[d] = { name: '', phone: d };
  }
  return out;
}

/**
 * Mensajes de quien solo vino con su lid: el teléfono, si la libreta ya lo
 * conoce (una consulta por lid distinto de la tanda).
 */
export async function resolveLidSenders<E extends { type: string }>(scope: Pick<ContactScope, 'app' | 'accountId'>, events: E[]): Promise<E[]> {
  const cache = new Map<string, string>();
  const out: E[] = [];
  for (const e of events) {
    const m = e as unknown as { type: string; fromMe?: boolean; senderPhone?: string; senderLid?: string };
    if (m.type === 'message' && !m.fromMe && !m.senderPhone && m.senderLid) {
      if (!cache.has(m.senderLid)) cache.set(m.senderLid, await phoneForLid(scope, m.senderLid).catch(() => ''));
      const phone = cache.get(m.senderLid) ?? '';
      out.push(phone ? ({ ...e, senderPhone: phone } as E) : e);
    } else out.push(e);
  }
  return out;
}

/** Borra la libreta de una cuenta (al borrar la cuenta de Inbox o el número de Lines). */
export async function forgetContacts(app: WaApp, accountId: string): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM wa_contacts WHERE app = ? AND account_id = ?').run(app, accountId);
  await db.prepare('DELETE FROM wa_contact_sync WHERE app = ? AND account_id = ?').run(app, accountId);
}

/**
 * Lo que un mensaje enseña sobre quien lo manda y el chat: nombre de perfil,
 * teléfono y lid. Los propios no (el pushName es el nuestro).
 */
export function contactsFromMessage(e: { fromMe: boolean; isGroup: boolean; chatId: string; senderPhone: string; senderName: string; senderLid?: string; chatLid?: string }): ContactInput[] {
  if (e.fromMe) return [];
  const out: ContactInput[] = [];
  const phone = cleanPhone(e.senderPhone);
  const lid = cleanLid(e.senderLid);
  if (phone || lid) out.push({ ...(phone ? { phone } : {}), ...(lid ? { lid } : {}), ...(cleanName(e.senderName) ? { push: cleanName(e.senderName) } : {}) });
  const chatPhone = /@lid$/i.test(e.chatId) ? '' : cleanPhone(e.chatId.replace(/@.*/, ''));
  if (!e.isGroup && e.chatLid && chatPhone) out.push({ phone: chatPhone, lid: cleanLid(e.chatLid) });
  return out;
}
