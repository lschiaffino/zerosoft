/**
 * Lines: mandar un WhatsApp desde un workflow de HubSpot (acción "Send a
 * webhook" a POST /api/v1/groups/hubspot/send con una API key de zerosoft).
 * Server-only.
 *
 * El destino sale del registro de HubSpot: los chats y grupos vinculados a
 * esa empresa, negocio o contacto (groups_hubspot_links) y, si no hay
 * ninguno, el chat 1:1 con el teléfono del contacto. Solo chats que ya están
 * en Lines y que la persona dueña de la key puede ver. El texto admite
 * {{propiedad}} con las propiedades que manda HubSpot.
 *
 * HubSpot reintenta un webhook que falló: cada envío lleva un clientId
 * derivado del callbackId (o, sin él, del registro, el texto y el día), así un
 * reintento no manda dos veces al mismo chat.
 */
import { createHash } from 'node:crypto';
import { getDb } from './db';
import { GroupsError, sendMessage } from './groups';
import { canSeeChat, chatAccessSql, type GroupsViewer } from './groups-access';
import { phoneDigits } from './groups-provider';

const TYPES: Record<string, 'company' | 'deal' | 'contact'> = {
  company: 'company',
  companies: 'company',
  '0-2': 'company',
  deal: 'deal',
  deals: 'deal',
  '0-3': 'deal',
  contact: 'contact',
  contacts: 'contact',
  '0-1': 'contact',
};
const PHONE_PROPS = ['hs_whatsapp_phone_number', 'mobilephone', 'phone'];
const MAX_CHATS = 20;

export interface WorkflowSendInput {
  text: string;
  objectType: 'company' | 'deal' | 'contact' | null;
  objectId: string;
  phone: string;
  /** Solo por esta línea (id de número de Lines). */
  line: string;
  to: 'all' | 'groups' | 'dm';
  callbackId: string;
  properties: Record<string, string>;
}

const s = (v: unknown, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

/**
 * Lee el cuerpo del webhook (el de HubSpot con el registro y sus propiedades,
 * o uno armado a mano con los campos de abajo) y los parámetros de la URL,
 * que es donde se pone el texto cuando HubSpot manda su cuerpo estándar.
 */
export function parseWorkflowBody(body: Record<string, unknown>, query: URLSearchParams): WorkflowSendInput {
  const obj = (body.object && typeof body.object === 'object' ? body.object : body) as Record<string, unknown>;
  const rawProps = (obj.properties && typeof obj.properties === 'object' ? obj.properties : {}) as Record<string, unknown>;
  const fields = (body.fields && typeof body.fields === 'object' ? body.fields : body.inputFields && typeof body.inputFields === 'object' ? body.inputFields : {}) as Record<string, unknown>;
  const properties: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    // HubSpot manda { value } en algunos formatos y el valor directo en otros.
    const val = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v;
    if (val != null && typeof val !== 'object') properties[k] = String(val).slice(0, 2000);
  }
  for (const [k, v] of Object.entries(fields)) if (v != null && typeof v !== 'object' && !(k in properties)) properties[k] = String(v).slice(0, 2000);
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = s(body[k], 4096) || s(fields[k], 4096) || s(query.get(k), 4096);
      if (v) return v;
    }
    return '';
  };
  const typeRaw = (pick('objectType', 'type') || s(obj.objectType) || s(obj.objectTypeId)).toLowerCase();
  const explicit = (['company', 'deal', 'contact'] as const).find((t) => pick(`${t}Id`));
  const objectType = explicit ?? TYPES[typeRaw] ?? null;
  const objectId = (explicit ? pick(`${explicit}Id`) : '') || s(obj.objectId, 30) || s(obj.hs_object_id, 30) || properties.hs_object_id || pick('objectId');
  const phone = pick('phone') || (objectType === 'contact' || objectType === null ? (PHONE_PROPS.map((p) => properties[p]).find(Boolean) ?? '') : '');
  const to = pick('to');
  return {
    text: pick('text', 'message', 'body'),
    objectType,
    objectId: /^\d{1,20}$/.test(objectId) ? objectId : '',
    phone: phoneDigits(phone),
    line: pick('line', 'lineId', 'numberId'),
    to: to === 'groups' || to === 'dm' ? to : 'all',
    callbackId: s(body.callbackId, 100) || s((body.context as Record<string, unknown> | undefined)?.callbackId, 100),
    properties,
  };
}

/** {{firstname}} → el valor de esa propiedad (vacío si no vino). */
export function fillTemplate(text: string, props: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]{1,100})\s*\}\}/g, (_, k: string) => props[k] ?? props[k.toLowerCase()] ?? '');
}

export interface WorkflowSendResult {
  sent: Array<{ chatId: string; messageId: string; duplicate: boolean }>;
  /** Chats que coincidieron (entre los que la key ve) pero no son del tipo o la línea pedidos, o pasan el tope. */
  skipped: number;
}

/** Busca los chats y manda. `viewer` es la persona dueña de la key: mismo acceso que en la app. */
export async function sendFromHubspotWorkflow(viewer: GroupsViewer, actor: string, input: WorkflowSendInput, now = new Date()): Promise<WorkflowSendResult> {
  const ws = viewer.ws;
  const text = fillTemplate(input.text, input.properties).trim().slice(0, 4096);
  if (!text) throw new GroupsError('empty_message');
  if (!input.objectId && !input.phone) throw new GroupsError('no_target');
  const db = getDb();
  type Row = { id: string; kind: 'dm' | 'group'; number_id: string };
  let rows: Row[] = [];
  // Solo los chats que la persona de la key ve (líneas y etiquetas): los otros ni se cuentan ni ocupan lugar.
  const access = chatAccessSql(viewer, 'c');
  const seen = access ? { sql: ` AND ${access.sql}`, args: access.args } : { sql: '', args: [] as string[] };
  if (input.objectId) {
    rows = (await db
      .prepare(
        `SELECT c.id, c.kind, c.number_id FROM groups_hubspot_links l JOIN groups_chats c ON c.id = l.chat_id
         WHERE l.user_id = ? AND l.object_id = ?${input.objectType ? ' AND l.object_type = ?' : ''}${seen.sql} ORDER BY c.last_message_at DESC LIMIT 200`,
      )
      .all(ws, input.objectId, ...(input.objectType ? [input.objectType] : []), ...seen.args)) as Row[];
  }
  if (rows.length === 0 && input.phone.length >= 8) {
    rows = (await db
      .prepare(`SELECT c.id, c.kind, c.number_id FROM groups_chats c WHERE c.user_id = ? AND c.kind = 'dm' AND c.phone = ?${seen.sql} ORDER BY c.last_message_at DESC LIMIT 20`)
      .all(ws, input.phone, ...seen.args)) as Row[];
    // Un mismo teléfono en varias líneas: se le escribe una vez, por la del último mensaje (o la pedida).
    if (!input.line) rows = rows.slice(0, 1);
  }
  const wanted = rows.filter((r) => (input.to === 'all' || (input.to === 'groups' ? r.kind === 'group' : r.kind === 'dm')) && (!input.line || r.number_id === input.line));
  let skipped = rows.length - wanted.length;
  const seed = input.callbackId || `${input.objectType ?? ''}:${input.objectId}:${input.phone}:${text}:${now.toISOString().slice(0, 10)}`;
  const sent: WorkflowSendResult['sent'] = [];
  for (const r of wanted.slice(0, MAX_CHATS)) {
    if (!(await canSeeChat(viewer, r.id))) {
      skipped++;
      continue;
    }
    const clientId = `hsw-${createHash('sha256').update(`${seed}|${r.id}`).digest('hex').slice(0, 32)}`;
    const existing = (await db.prepare('SELECT id FROM groups_messages WHERE chat_id = ? AND client_id = ?').get(r.id, clientId)) as { id: string } | undefined;
    if (existing) {
      sent.push({ chatId: r.id, messageId: existing.id, duplicate: true });
      continue;
    }
    const msg = await sendMessage(ws, actor, r.id, { body: text, authorKind: 'api', clientId });
    sent.push({ chatId: r.id, messageId: msg.id, duplicate: false });
  }
  skipped += Math.max(0, wanted.length - MAX_CHATS);
  if (sent.length === 0) throw new GroupsError('no_chat', 404);
  return { sent, skipped };
}
