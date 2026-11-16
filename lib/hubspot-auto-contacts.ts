/**
 * HubSpot: alta automática de contactos cuando entra un chat 1:1 nuevo, en
 * Lines y en Inbox. Apagada por defecto.
 *
 * - Lines: ajuste del workspace (groups_hubspot.auto_create). Vale para los
 *   chats creados después de prenderlo y solo en líneas que ve todo el
 *   workspace (como el registro de notas: lo de una línea restringida no se
 *   copia solo a HubSpot).
 * - Inbox: ajuste de cada persona (inbox_hubspot_auto), porque sus chats son
 *   suyos. Usa el HubSpot del workspace donde lo prendió, mientras siga siendo
 *   parte (no invitada).
 *
 * Antes de crear: si la persona ya tiene contacto en el workspace no se hace
 * nada, y si en HubSpot ya hay un contacto con ese teléfono tampoco (queda la
 * sugerencia para vincularlo a mano). El contacto nuevo se asocia a la empresa
 * de sus grupos si es una sola (lib/groups-contacts.ts → createPersonHubspot).
 * Cada chat se reclama con una fila en hubspot_auto_contacts (compare-and-set)
 * para que dos corridas del cron no lo creen dos veces. Server-only.
 */
import { getDb } from './db';
import { HubspotError, hubspotConnected } from './groups-hubspot';
import { createPersonHubspot, personHasHubspotLink, type PersonLite } from './groups-contacts';
import { realName } from './wa-people';

const LID_NAMES = ['Contacto de WhatsApp', 'WhatsApp contact', 'Contato do WhatsApp'];
/** Errores que no se arreglan reintentando el mismo chat en un minuto. */
const STOP_WS = new Set(['hubspot_invalid_token', 'hubspot_missing_scopes', 'hubspot_not_connected']);
/** Errores pasajeros: se suelta el chat para la próxima corrida. */
const RETRY = new Set(['hubspot_rate_limited', 'hubspot_unreachable', 'hubspot_error']);

interface Candidate {
  key: string;
  ws: string;
  phone: string;
  lid: string;
  name: string;
}

const digits = (v: string) => v.replace(/\D/g, '');

/** El ajuste de Inbox de una persona en un workspace. */
export async function getInboxHubspotAuto(owner: string, ws: string): Promise<boolean> {
  const row = (await getDb().prepare('SELECT ws FROM inbox_hubspot_auto WHERE owner_id = ?').get(owner)) as { ws: string } | undefined;
  return row?.ws === ws;
}

/**
 * Prende o apaga el alta automática en el Inbox de una persona, con el HubSpot
 * de `ws` (el workspace activo). Prenderla de nuevo corre la fecha: los chats
 * que entraron mientras estaba apagada no se suben.
 */
export async function setInboxHubspotAuto(owner: string, ws: string, on: boolean): Promise<boolean> {
  const db = getDb();
  if (!on) {
    await db.prepare('DELETE FROM inbox_hubspot_auto WHERE owner_id = ?').run(owner);
    return false;
  }
  if (!(await hubspotConnected(ws))) throw new HubspotError('hubspot_not_connected', 409);
  const { hubspotConn, HUBSPOT_CONTACT_WRITE_SCOPE } = await import('./groups-hubspot');
  const conn = await hubspotConn(ws);
  if (!conn?.scopes.includes(HUBSPOT_CONTACT_WRITE_SCOPE)) throw new HubspotError(`hubspot_missing_scopes:${HUBSPOT_CONTACT_WRITE_SCOPE}`);
  if (await getInboxHubspotAuto(owner, ws)) return true;
  await db
    .prepare('INSERT INTO inbox_hubspot_auto (owner_id, ws, since) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET ws = excluded.ws, since = excluded.since')
    .run(owner, ws, new Date().toISOString());
  return true;
}

async function linesCandidates(limit: number): Promise<Candidate[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.user_id, c.phone, c.provider_chat_id, c.name FROM groups_hubspot h
       JOIN groups_chats c ON c.user_id = h.user_id
       JOIN groups_numbers nb ON nb.id = c.number_id AND nb.visibility = 'all'
       WHERE h.token != '' AND h.auto_create = 1 AND h.auto_create_since IS NOT NULL
         AND c.kind = 'dm' AND c.phone != '' AND c.hidden_at IS NULL AND c.created_at >= h.auto_create_since
         AND NOT EXISTS (SELECT 1 FROM groups_hubspot_links l WHERE l.chat_id = c.id AND l.object_type = 'contact')
         AND NOT EXISTS (SELECT 1 FROM hubspot_auto_contacts a WHERE a.chat_key = 'lines:' || c.id)
       ORDER BY c.created_at ASC LIMIT ?`,
    )
    .all(limit)) as Array<{ id: string; user_id: string; phone: string; provider_chat_id: string; name: string }>;
  return rows.map((r) => ({
    key: `lines:${r.id}`,
    ws: r.user_id,
    phone: digits(r.phone),
    lid: r.provider_chat_id.endsWith('@lid') ? r.provider_chat_id.slice(0, -4) : '',
    name: realName(r.name, LID_NAMES),
  }));
}

async function inboxCandidates(limit: number): Promise<Candidate[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.id, s.ws, t.handle, t.external_id, t.title FROM inbox_hubspot_auto s
       JOIN groups_hubspot h ON h.user_id = s.ws AND h.token != ''
       JOIN inbox_threads t ON t.owner_id = s.owner_id
       WHERE t.channel = 'whatsapp' AND t.kind = 'dm' AND t.handle != '' AND t.removed_at IS NULL AND t.created_at >= s.since
         AND (s.owner_id = s.ws OR EXISTS (
           SELECT 1 FROM team_members m JOIN teams tm ON tm.id = m.team_id WHERE tm.owner_id = s.ws AND m.user_id = s.owner_id AND m.role != 'guest'))
         AND NOT EXISTS (SELECT 1 FROM hubspot_auto_contacts a WHERE a.chat_key = 'inbox:' || t.id)
       ORDER BY t.created_at ASC LIMIT ?`,
    )
    .all(limit)) as Array<{ id: string; ws: string; handle: string; external_id: string; title: string }>;
  return rows.map((r) => ({
    key: `inbox:${r.id}`,
    ws: r.ws,
    phone: digits(r.handle),
    lid: r.external_id.endsWith('@lid') ? r.external_id.slice(0, -4) : '',
    name: realName(r.title, LID_NAMES),
  }));
}

/**
 * Cron: crea en HubSpot el contacto de los chats 1:1 nuevos (Lines e Inbox)
 * con el ajuste prendido. Devuelve cuántos creó.
 */
export async function sweepHubspotAutoContacts(limit = 10): Promise<number> {
  const db = getDb();
  const list = [...(await linesCandidates(limit)), ...(await inboxCandidates(limit))];
  const stopped = new Set<string>();
  let created = 0;
  for (const c of list) {
    if (stopped.has(c.ws)) continue;
    const claim = await db.prepare("INSERT OR IGNORE INTO hubspot_auto_contacts (chat_key, ws, result, created_at) VALUES (?, ?, 'pending', ?)").run(c.key, c.ws, new Date().toISOString());
    if (claim.changes === 0) continue;
    const done = (result: string) => db.prepare('UPDATE hubspot_auto_contacts SET result = ? WHERE chat_key = ?').run(result, c.key);
    if (c.phone.length < 8 || c.phone.length > 15) {
      await done('no_phone');
      continue;
    }
    const person: PersonLite = { phone: c.phone, lid: c.lid, name: c.name, groups: [] };
    try {
      if (await personHasHubspotLink(c.ws, person)) {
        await done('linked');
        continue;
      }
      const res = await createPersonHubspot(c.ws, null, false, person);
      await done(res.created ? 'created' : 'existing');
      if (res.created) created++;
    } catch (err) {
      if (!(err instanceof HubspotError)) throw err;
      const code = err.code.split(':')[0];
      if (RETRY.has(code)) {
        // Se suelta el chat: lo toma la próxima corrida.
        await db.prepare('DELETE FROM hubspot_auto_contacts WHERE chat_key = ?').run(c.key);
        stopped.add(c.ws);
      } else {
        // El error queda en el chat y en la conexión (Ajustes › Integraciones lo muestra).
        await done(code.slice(0, 60));
        if (STOP_WS.has(code)) stopped.add(c.ws);
      }
    }
  }
  return created;
}
