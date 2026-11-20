/**
 * Lines: traer de Periskope con su API pública (api.periskope.app/v1, una
 * clave de Settings › API de Periskope). Server-only.
 *
 * Lo que trae, sobre los chats que ya están en Lines (llegan al conectar cada
 * línea por QR):
 * - chats: etiquetas, asignado (por email) y propiedades propias. Las
 *   propiedades de chat que no existen en Lines se crean con su tipo y sus
 *   opciones (dropdown → selección, picklist → selección múltiple).
 * - contactos: sus etiquetas, sobre los chats 1:1 con ese número.
 * - tickets: con asunto, estado, prioridad, asignado y fecha original, ligados
 *   al chat (y al mensaje, si está en Lines). Sin vencimientos: lo viejo no
 *   dispara avisos de SLA.
 * - notas privadas: en el chat, con su fecha y autor (si el email es de alguien
 *   del workspace).
 *
 * Las filas de chats y contactos pasan por importPeriskopeRows, igual que el
 * CSV. Volver a correrlo no duplica: los tickets se reconocen por
 * created_by = 'periskope:<ticket_id>' y las notas por client_id =
 * 'psk:<message_id>'. La clave se usa solo durante el pedido: no se guarda.
 * Con GROUPS_PERISKOPE_FAKE=1 responde una cuenta simulada armada con los
 * chats del workspace (lib/groups-periskope-fake.ts).
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { GroupsError, createPropertyDef, listPeople, listPropertyDefs, type PropertyType } from './groups';
import { recordAudit } from './groups-audit';
import { importPeriskopeRows, type ImportIssue, type PeriskopeResult } from './groups-periskope';
import { phoneDigits } from './groups-provider';

export const PERISKOPE_API = 'https://api.periskope.app/v1';

/** Topes por corrida: lo que entra en un pedido. Lo que queda se trae volviendo a importar (no duplica). */
export const API_CAPS = { chats: 5000, contacts: 5000, tickets: 1000, notes: 1500 } as const;
const PAGE = { chats: 2000, contacts: 2000, tickets: 1000, notes: 500 } as const;

export type PeriskopeFetch = (path: string) => Promise<unknown>;

export interface PskChat {
  chat_id: string;
  chat_name?: string | null;
  chat_type?: string | null;
  org_phone?: string | null;
  labels?: string[] | null;
  assigned_to?: string | null;
  custom_properties?: Record<string, unknown> | null;
}
export interface PskContact {
  contact_id: string;
  contact_name?: string | null;
  labels?: string[] | null;
}
export interface PskTicket {
  ticket_id: string;
  chat_id?: string | null;
  subject?: string | null;
  status?: string | null;
  priority?: number | null;
  assignee?: string | null;
  quoted_message_id?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
  is_deleted?: boolean | null;
}
export interface PskNote {
  message_id: string;
  chat_id?: string | null;
  org_phone?: string | null;
  body?: string | null;
  timestamp?: string | null;
  performed_by?: string | null;
  media?: { filename?: string | null } | null;
  is_deleted?: boolean | null;
}
export interface PskProperty {
  property_id: string;
  property_name: string;
  type?: string;
  kind?: string;
  options?: Array<{ id?: string; label?: string }> | null;
}

export interface PeriskopeApiResult {
  dryRun: boolean;
  phones: number;
  properties: { found: number; created: number };
  chats: PeriskopeResult;
  contacts: PeriskopeResult;
  tickets: { found: number; applied: number; existing: number; issues: ImportIssue[] };
  notes: { found: number; applied: number; existing: number; issues: ImportIssue[] };
  /** Quedó algo sin traer por los topes: volver a importar trae lo que falta. */
  truncated: boolean;
}

/** Errores de la API de Periskope en códigos que la pantalla traduce. */
function apiError(status: number): GroupsError {
  if (status === 401 || status === 403) return new GroupsError('periskope_auth', 400);
  if (status === 429) return new GroupsError('periskope_rate_limited', 429);
  return new GroupsError('periskope_unavailable', 502);
}

/** El cliente real: GET con la clave como Bearer, 20 s por pedido. */
export function periskopeFetcher(key: string, fetchImpl: typeof fetch = fetch): PeriskopeFetch {
  return async (path) => {
    let res: Response;
    try {
      res = await fetchImpl(`${PERISKOPE_API}${path}`, {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new GroupsError('periskope_unavailable', 502);
    }
    if (!res.ok) throw apiError(res.status);
    try {
      return await res.json();
    } catch {
      throw new GroupsError('periskope_unavailable', 502);
    }
  };
}

/** Pagina un listado (`{ <key>: [...] }`) con offset y limit hasta el tope. */
async function listAll<T>(get: PeriskopeFetch, path: string, key: string, page: number, cap: number, extra = ''): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let offset = 0; items.length < cap; offset += page) {
    const body = (await get(`${path}?offset=${offset}&limit=${page}${extra}`)) as Record<string, unknown> | null;
    const batch = Array.isArray(body?.[key]) ? (body![key] as T[]) : [];
    items.push(...batch);
    if (batch.length < page) return { items: items.slice(0, cap), truncated: false };
  }
  return { items: items.slice(0, cap), truncated: true };
}

/** Tipo de propiedad de Lines para un kind de Periskope. */
export function propertyTypeFrom(kind: string | undefined): PropertyType {
  if (kind === 'dropdown') return 'select';
  if (kind === 'picklist') return 'multiselect';
  if (kind === 'date') return 'date';
  return 'text';
}

/** Un valor de propiedad de Periskope como celda (la misma que leería el CSV). */
export function propertyCell(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(propertyCell).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return propertyCell(o.label ?? o.value ?? o.name ?? o.url ?? '');
  }
  return String(v).trim();
}

/** 1 baja, 2 media, 3 alta, 4 urgente (0 o vacío: baja, como en Periskope). */
export function ticketPriorityFrom(p: unknown): 'low' | 'medium' | 'high' | 'urgent' {
  const n = Number(p);
  return n >= 4 ? 'urgent' : n === 3 ? 'high' : n === 2 ? 'medium' : 'low';
}

/** open → abierto, inprogress → en curso, closed y archived → cerrado. */
export function ticketStatusFrom(s: unknown): 'open' | 'in_progress' | 'closed' {
  const v = String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return v === 'inprogress' ? 'in_progress' : v === 'closed' || v === 'archived' ? 'closed' : 'open';
}

/** Fecha ISO válida o null. */
function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T').replace(/\+00$/, 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type ChatLite = { id: string; number_id: string; kind: string; provider_chat_id: string; phone: string };

/**
 * Trae todo lo que la API expone y lo aplica (o, con dryRun, cuenta lo que
 * haría sin escribir). `get` se inyecta en los tests.
 */
export async function importPeriskopeApi(ws: string, actor: string, get: PeriskopeFetch, opts: { dryRun?: boolean } = {}): Promise<PeriskopeApiResult> {
  const dryRun = opts.dryRun === true;
  // La clave primero: un 401 acá corta antes de pedir el resto.
  const phones = await get('/phones/all');
  const phoneCount = Array.isArray(phones) ? phones.length : 0;

  const propsBody = (await get('/properties?type=chat')) as { data?: PskProperty[] } | null;
  const pskProps = (Array.isArray(propsBody?.data) ? propsBody!.data : []).filter((p) => p && p.property_name && (p.type ?? 'chat') === 'chat');
  const chats = await listAll<PskChat>(get, '/chats', 'chats', PAGE.chats, API_CAPS.chats);
  const contacts = await listAll<PskContact>(get, '/contacts', 'contacts', PAGE.contacts, API_CAPS.contacts);
  const tickets = await listAll<PskTicket>(get, '/tickets', 'tickets', PAGE.tickets, API_CAPS.tickets);
  const notes = await listAll<PskNote>(get, '/notes', 'notes', PAGE.notes, API_CAPS.notes, '&start_time=2015-01-01');

  // ---------- Propiedades de chat: las que faltan se crean ----------
  const byId = new Map(pskProps.map((p) => [p.property_id, p.property_name]));
  const propName = (k: string) => byId.get(k) ?? k;
  const used = new Set<string>();
  for (const c of chats.items) for (const [k, v] of Object.entries(c.custom_properties ?? {})) if (propertyCell(v)) used.add(propName(k));
  const defs = await listPropertyDefs(ws);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  let createdProps = 0;
  for (const name of used) {
    if (defs.some((d) => norm(d.label) === norm(name) || norm(d.key) === norm(name))) continue;
    const def = pskProps.find((p) => p.property_name === name);
    const type = propertyTypeFrom(def?.kind);
    createdProps++;
    if (dryRun) continue;
    const options = (def?.options ?? []).map((o) => String(o.label ?? '').trim()).filter(Boolean);
    const created = await createPropertyDef(ws, { label: name, type, options }).catch(() => null);
    if (created) defs.push(created);
    else createdProps--;
  }
  const propNames = [...used];

  // ---------- Chats y contactos: las mismas filas que el CSV ----------
  const chatRows: string[][] = [['Chat ID', 'Chat Name', 'Chat Type', 'Org Phone', 'Labels', 'Assigned To', ...propNames]];
  for (const c of chats.items) {
    if (!c?.chat_id) continue;
    const props = new Map(
      Object.entries(c.custom_properties ?? {}).map(([k, v]) => {
        const name = propName(k);
        const cell = propertyCell(v);
        // Las fechas como AAAA-MM-DD, el formato de las propiedades de fecha de Lines.
        const isDate = pskProps.find((p) => p.property_name === name)?.kind === 'date';
        return [name, isDate && /^\d{4}-\d{2}-\d{2}/.test(cell) ? cell.slice(0, 10) : cell];
      }),
    );
    chatRows.push([
      c.chat_id,
      c.chat_name ?? '',
      c.chat_type ?? '',
      (c.org_phone ?? '').replace(/@.*$/, ''),
      (c.labels ?? []).join(', '),
      c.assigned_to ?? '',
      ...propNames.map((n) => props.get(n) ?? ''),
    ]);
  }
  const chatResult = await importPeriskopeRows(ws, actor, 'chats', chatRows, { dryRun, maxRows: API_CAPS.chats, audit: false });
  // Las columnas de propiedades son de Periskope: en la vista previa las que se van a crear todavía no existen.
  chatResult.ignoredColumns = chatResult.ignoredColumns.filter((c) => !used.has(c));
  // Un contacto sin etiquetas no aporta nada (el nombre viene de WhatsApp).
  const contactRows: string[][] = [['Phone', 'Name', 'Labels']];
  for (const c of contacts.items) if (c?.contact_id && (c.labels ?? []).length) contactRows.push([c.contact_id, c.contact_name ?? '', (c.labels ?? []).join(', ')]);
  const contactResult = await importPeriskopeRows(ws, actor, 'contacts', contactRows, { dryRun, maxRows: API_CAPS.contacts, audit: false });

  // ---------- Tickets y notas: sobre el chat de Lines ----------
  const db = getDb();
  const lines = (await db.prepare('SELECT id, phone FROM groups_numbers WHERE user_id = ?').all(ws)) as Array<{ id: string; phone: string }>;
  const people = await listPeople(ws);
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p.id]));
  const chatCache = new Map<string, ChatLite | null>();
  const findChat = async (jid: string, orgPhone: string): Promise<ChatLite | null> => {
    const k = `${jid}|${orgPhone}`;
    if (chatCache.has(k)) return chatCache.get(k)!;
    const isGroup = jid.endsWith('@g.us');
    const phone = isGroup ? '' : phoneDigits(jid.replace(/@.*$/, ''));
    const line = orgPhone ? lines.find((n) => n.phone && phoneDigits(n.phone) === phoneDigits(orgPhone.replace(/@.*$/, ''))) : undefined;
    let row: ChatLite | null = null;
    if (isGroup || phone.length >= 6) {
      const rows = (await db
        .prepare(
          `SELECT id, number_id, kind, provider_chat_id, phone FROM groups_chats WHERE user_id = ? AND ${isGroup ? 'provider_chat_id = ?' : "kind = 'dm' AND (phone = ? OR provider_chat_id = ?)"} ORDER BY last_message_at DESC`,
        )
        .all(ws, ...(isGroup ? [jid] : [phone, jid]))) as ChatLite[];
      row = (line && rows.find((r) => r.number_id === line.id)) || rows[0] || null;
    }
    chatCache.set(k, row);
    return row;
  };

  const ticketOut: PeriskopeApiResult['tickets'] = { found: 0, applied: 0, existing: 0, issues: [] };
  const done = new Set(
    ((await db.prepare("SELECT created_by FROM groups_tickets WHERE user_id = ? AND created_by LIKE 'periskope:%'").all(ws)) as Array<{ created_by: string }>).map((r) => r.created_by),
  );
  for (const t of tickets.items) {
    if (!t?.ticket_id || t.is_deleted) continue;
    ticketOut.found++;
    const marker = `periskope:${String(t.ticket_id).slice(0, 80)}`;
    if (done.has(marker)) {
      ticketOut.existing++;
      continue;
    }
    const chat = t.chat_id ? await findChat(t.chat_id, '') : null;
    if (!chat) {
      ticketOut.issues.push({ line: ticketOut.found, reason: `chat_not_found:${t.ticket_id}` });
      continue;
    }
    const assignee = t.assignee ? (byEmail.get(t.assignee.toLowerCase()) ?? null) : null;
    if (t.assignee && !assignee) ticketOut.issues.push({ line: ticketOut.found, reason: `unknown_assignee:${t.ticket_id}` });
    ticketOut.applied++;
    done.add(marker);
    if (dryRun) continue;
    // El mensaje del que salió, si está en Lines (Periskope usa "true_<chat>_<id>"; el id de WhatsApp es lo último).
    let messageId: string | null = null;
    const waId = String(t.quoted_message_id ?? '').split('_').pop() ?? '';
    if (waId.length >= 8) {
      const m = (await db
        .prepare(
          `SELECT id FROM groups_messages WHERE chat_id = ? AND (provider_message_id = ? OR provider_message_id LIKE ?)
             AND NOT EXISTS (SELECT 1 FROM groups_tickets t WHERE t.message_id = groups_messages.id) LIMIT 1`,
        )
        .get(chat.id, waId, `%${waId}`)) as { id: string } | undefined;
      messageId = m?.id ?? null;
    }
    const status = ticketStatusFrom(t.status);
    const created = isoOrNull(t.created_at) ?? new Date().toISOString();
    const closed = status === 'closed' ? (isoOrNull(t.closed_at) ?? created) : null;
    const title = (t.subject ?? '').trim().slice(0, 200) || String(t.ticket_id).slice(0, 200);
    for (let attempt = 0; attempt < 5; attempt++) {
      const next = (await db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM groups_tickets WHERE user_id = ?').get(ws)) as { n: number };
      try {
        await db
          .prepare(
            `INSERT INTO groups_tickets (id, user_id, number, chat_id, message_id, title, status, priority, assignee_id, source,
               due_at, first_response_due_at, resolved_at, created_by, created_at, updated_at, fields)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', NULL, NULL, ?, ?, ?, ?, '{}')`,
          )
          .run(randomUUID(), ws, Number(next.n), chat.id, messageId, title, status, ticketPriorityFrom(t.priority), assignee, closed, marker, created, closed ?? created);
        break;
      } catch (err) {
        if (!/UNIQUE/i.test(String(err)) || attempt === 4) {
          ticketOut.applied--;
          ticketOut.issues.push({ line: ticketOut.found, reason: `not_applied:${t.ticket_id}` });
          break;
        }
      }
    }
  }

  const noteOut: PeriskopeApiResult['notes'] = { found: 0, applied: 0, existing: 0, issues: [] };
  const seen = new Set(
    ((await db.prepare("SELECT client_id FROM groups_messages WHERE user_id = ? AND client_id LIKE 'psk:%'").all(ws)) as Array<{ client_id: string }>).map((r) => r.client_id),
  );
  const { insertMessage } = await import('./groups');
  let missingChats = 0;
  for (const n of notes.items) {
    if (!n?.message_id || n.is_deleted) continue;
    noteOut.found++;
    const clientId = `psk:${String(n.message_id).slice(0, 120)}`;
    if (seen.has(clientId)) {
      noteOut.existing++;
      continue;
    }
    const body = (n.body ?? '').trim() || (n.media?.filename ?? '').trim();
    if (!body) continue;
    const chat = n.chat_id ? await findChat(n.chat_id, n.org_phone ?? '') : null;
    if (!chat) {
      missingChats++;
      continue;
    }
    seen.add(clientId);
    noteOut.applied++;
    if (dryRun) continue;
    await insertMessage({
      ws,
      chatId: chat.id,
      numberId: chat.number_id,
      providerMessageId: null,
      direction: 'note',
      authorId: n.performed_by ? (byEmail.get(n.performed_by.toLowerCase()) ?? null) : null,
      body,
      status: 'sent',
      createdAt: isoOrNull(n.timestamp) ?? undefined,
      clientId,
      meta: { importedFrom: 'periskope' },
    });
  }
  if (missingChats) noteOut.issues.push({ line: 0, reason: `notes_chat_not_found:${missingChats}` });

  const result: PeriskopeApiResult = {
    dryRun,
    phones: phoneCount,
    properties: { found: used.size, created: createdProps },
    chats: chatResult,
    contacts: contactResult,
    tickets: { ...ticketOut, issues: ticketOut.issues.slice(0, 100) },
    notes: noteOut,
    truncated: chats.truncated || contacts.truncated || tickets.truncated || notes.truncated,
  };
  const applied = chatResult.applied + contactResult.applied + ticketOut.applied + noteOut.applied;
  if (!dryRun && applied > 0) {
    await recordAudit(ws, {
      chatId: null,
      chatName: 'Periskope',
      actorId: actor,
      action: 'imported',
      detail: {
        source: 'periskope',
        kind: 'api',
        chats: chatResult.applied,
        contacts: contactResult.applied,
        tickets: ticketOut.applied,
        notes: noteOut.applied,
        labels: chatResult.created.labels + contactResult.created.labels,
        properties: createdProps,
      },
    });
  }
  return result;
}
