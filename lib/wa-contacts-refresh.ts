/**
 * Repaso diario de WhatsApp, para Inbox (cada cuenta personal) y Lines (cada
 * número): una vez por día y por cuenta vuelve a traer los contactos del
 * servidor (findContacts: nombres y lid ↔ teléfono) y, chat por chat, sus
 * datos (chatInfo): nombre e "info" de cada contacto, asunto, descripción,
 * participantes y foto de cada grupo. Lo que cambió en WhatsApp (alguien se
 * cambió el nombre, un grupo cambió de asunto o de foto) queda al día.
 *
 * Despacio y en tandas: corre desde el cron de cada minuto con un tope de
 * tiempo, deja una pausa entre pedidos al servidor y guarda por dónde iba
 * (wa_contact_sync: fase y cursor) para seguir en la próxima corrida. Cada
 * cuenta se reclama con compare-and-set (claimed_until): dos corridas nunca
 * repasan la misma a la vez. El repaso que se hace al abrir un chat sigue
 * igual (lib/inbox/wa-meta.ts). De paso relee la privacidad de la cuenta
 * ("Confirmaciones de lectura", lib/wa-privacy.ts) si tiene más de un día.
 * Server-only.
 */
import { getDb } from './db';
import type { GroupsProvider } from './groups-provider';
import type { WaApp } from './wa-contacts';
import { privacyStale, refreshPrivacy } from './wa-privacy';

/** Cada cuánto se repasa una cuenta entera. */
export const REFRESH_EVERY_MS = 24 * 3600_000;
/** Pausa entre pedidos al servidor de WhatsApp (no saturarlo). */
export const REFRESH_GAP_MS = 350;
/** Contactos por página de findContacts. */
const CONTACT_PAGE = 500;
const MAX_CONTACT_PAGES = 100;
/** Chats que se leen de la base por vez. */
const CHAT_BATCH = 20;
/** Cuentas por corrida como máximo. */
const ACCOUNTS_PER_RUN = 5;
const CLAIM_MS = 3 * 60_000;

export type RefreshPhase = 'contacts' | 'chats' | 'idle';

interface SyncRow {
  app: WaApp;
  account_id: string;
  user_id: string;
  phase: RefreshPhase;
  cursor: string;
  started_at: string | null;
  finished_at: string | null;
  claimed_until: string | null;
  updated_at: string;
}

/** Lo que el repaso necesita de cada app. */
export interface RefreshTarget {
  provider: GroupsProvider;
  /** Contactos del servidor → libreta (y renombres). */
  learnContacts(rows: Awaited<ReturnType<NonNullable<GroupsProvider['history']>['contacts']>>): Promise<unknown>;
  /** Nombres de la libreta en los chats y miembros que solo tenían el número. */
  fillNames(): Promise<unknown>;
  /** Chats de la cuenta después de `after` (por id), los que se repasan. */
  chats(after: string, limit: number): Promise<string[]>;
  /** Pide y guarda los datos de un chat (un pedido al servidor). */
  refreshChat(id: string): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Agrega al repaso las cuentas conectadas que todavía no estaban: empiezan
 * enseguida. Las del WhatsApp de prueba (`later`) esperan al día siguiente:
 * en los tests, el cron no toca los chats de otras pruebas.
 */
export async function enrollAccounts(app: WaApp, accounts: Array<{ id: string; userId: string; later?: boolean }>, now = new Date()): Promise<void> {
  const db = getDb();
  const at = now.toISOString();
  const known = new Set(
    accounts.length
      ? ((await db.prepare(`SELECT account_id FROM wa_contact_sync WHERE app = ? AND account_id IN (${accounts.map(() => '?').join(',')})`).all(app, ...accounts.map((a) => a.id))) as Array<{
          account_id: string;
        }>).map((r) => r.account_id)
      : [],
  );
  for (const a of accounts) {
    if (known.has(a.id)) continue;
    await db
      .prepare('INSERT OR IGNORE INTO wa_contact_sync (app, account_id, user_id, phase, cursor, finished_at, updated_at) VALUES (?, ?, ?, ?, \'\', ?, ?)')
      .run(app, a.id, a.userId, a.later ? 'idle' : 'contacts', a.later ? at : null, at);
  }
}

/** Cuentas que toca repasar (en curso o con el último repaso de hace más de un día), sin reclamar. */
export async function dueAccounts(app: WaApp, ids: string[], now = new Date()): Promise<SyncRow[]> {
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const stale = new Date(now.getTime() - REFRESH_EVERY_MS).toISOString();
  return (await getDb()
    .prepare(
      `SELECT * FROM wa_contact_sync WHERE app = ? AND account_id IN (${marks})
         AND (phase <> 'idle' OR finished_at IS NULL OR finished_at < ?) AND (claimed_until IS NULL OR claimed_until < ?)
       ORDER BY updated_at LIMIT ?`,
    )
    .all(app, ...ids, stale, now.toISOString(), ACCOUNTS_PER_RUN)) as unknown as SyncRow[];
}

/**
 * Un paso del repaso de una cuenta, hasta `deadline`. Devuelve en qué fase
 * quedó, o null si otra corrida la tenía reclamada.
 */
export async function refreshAccount(app: WaApp, accountId: string, target: RefreshTarget, deadline: number, now = new Date(), gapMs = REFRESH_GAP_MS): Promise<RefreshPhase | null> {
  const db = getDb();
  const nowS = now.toISOString();
  const until = new Date(now.getTime() + CLAIM_MS).toISOString();
  const claim = await db
    .prepare('UPDATE wa_contact_sync SET claimed_until = ? WHERE app = ? AND account_id = ? AND (claimed_until IS NULL OR claimed_until < ?)')
    .run(until, app, accountId, nowS);
  if (!claim.changes) return null;
  const row = (await db.prepare('SELECT * FROM wa_contact_sync WHERE app = ? AND account_id = ?').get(app, accountId)) as SyncRow | undefined;
  if (!row) return null;
  // Una cuenta en reposo que toca repasar empieza de cero.
  const fresh = row.phase === 'idle';
  let phase = (fresh ? 'contacts' : row.phase) as RefreshPhase;
  let cursor = fresh ? '' : row.cursor;
  const started = fresh ? nowS : (row.started_at ?? nowS);
  let finished = row.finished_at;
  let requests = 0;
  const pause = async () => {
    if (requests++ > 0 && gapMs > 0) await sleep(gapMs);
  };
  try {
    while (phase !== 'idle' && Date.now() + 1_500 < deadline) {
      if (phase === 'contacts') {
        const history = target.provider.history;
        if (!history) {
          phase = 'chats';
          cursor = '';
          continue;
        }
        const page = Number(cursor) || 0;
        await pause();
        const rows = await history.contacts(page, CONTACT_PAGE);
        await target.learnContacts(rows);
        if (rows.length < CONTACT_PAGE || page + 1 >= MAX_CONTACT_PAGES) {
          await target.fillNames();
          phase = 'chats';
          cursor = '';
        } else cursor = String(page + 1);
        continue;
      }
      // phase === 'chats'
      if (!target.provider.chatInfo) {
        phase = 'idle';
        break;
      }
      const ids = await target.chats(cursor, CHAT_BATCH);
      if (!ids.length) {
        await target.fillNames();
        phase = 'idle';
        break;
      }
      for (const id of ids) {
        if (Date.now() + 1_500 >= deadline) break;
        await pause();
        await target.refreshChat(id).catch(() => null);
        cursor = id;
      }
    }
  } catch {
    // El servidor falló (caído, límite): se sigue en la próxima corrida desde el mismo punto.
  }
  if (phase === 'idle') {
    finished = nowS;
    cursor = '';
  }
  await db
    .prepare('UPDATE wa_contact_sync SET phase = ?, cursor = ?, started_at = ?, finished_at = ?, claimed_until = NULL, updated_at = ? WHERE app = ? AND account_id = ? AND claimed_until = ?')
    .run(phase, cursor, started, finished, nowS, app, accountId, until);
  return phase;
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/** Solo esas cuentas (o todas sin lista): `AND id IN (...)` y sus valores. */
function onlyIds(ids: string[] | undefined): { sql: string; args: string[] } {
  if (!ids) return { sql: '', args: [] };
  return { sql: ` AND id IN (${ids.map(() => '?').join(',') || "''"})`, args: ids };
}

/**
 * Cron: el repaso diario de las cuentas de WhatsApp de Inbox. `accountIds` lo acota a esas cuentas (los
 * tests, que comparten la base con otras cuentas conectadas que le ganarían el turno de ACCOUNTS_PER_RUN).
 */
export async function refreshInboxDaily(now = new Date(), deadline = Date.now() + 12_000, gapMs = REFRESH_GAP_MS, accountIds?: string[]): Promise<number> {
  const { refreshChatInfo } = await import('./inbox/wa-meta');
  const { waProviderFor } = await import('./inbox/whatsapp');
  const { fillInboxTitles, learnFromHistoryContacts } = await import('./inbox/wa-names');
  const db = getDb();
  const only = onlyIds(accountIds);
  const accounts = (await db
    .prepare(`SELECT * FROM inbox_accounts WHERE kind = 'whatsapp' AND status = 'connected'${only.sql} LIMIT 500`)
    .all(...only.args)) as unknown as import('./inbox/core').AccountRow[];
  if (!accounts.length) return 0;
  await enrollAccounts('inbox', accounts.map((a) => ({ id: a.id, userId: a.owner_id, later: a.provider === 'fake' })), now);
  let n = 0;
  for (const s of await dueAccounts('inbox', accounts.map((a) => a.id), now)) {
    if (Date.now() + 2_000 > deadline) break;
    const account = accounts.find((a) => a.id === s.account_id)!;
    let provider: GroupsProvider;
    try {
      provider = waProviderFor(account);
    } catch {
      continue;
    }
    if (privacyStale((account as { privacy_at?: string | null }).privacy_at, now)) await refreshPrivacy('inbox', account.id, provider, now).catch(() => null);
    const target: RefreshTarget = {
      provider,
      learnContacts: (rows) => learnFromHistoryContacts(account, rows),
      fillNames: () => fillInboxTitles(account.id),
      chats: async (after, limit) =>
        (
          (await db
            .prepare("SELECT id FROM inbox_threads WHERE account_id = ? AND channel = 'whatsapp' AND id > ? ORDER BY id LIMIT ?")
            .all(account.id, after, limit)) as Array<{ id: string }>
        ).map((r) => r.id),
      refreshChat: async (id) => {
        const thread = (await db.prepare('SELECT * FROM inbox_threads WHERE id = ? AND account_id = ?').get(id, account.id)) as import('./inbox/core').ThreadRow | undefined;
        if (thread) await refreshChatInfo(account, thread, now);
      },
    };
    if (await refreshAccount('inbox', account.id, target, deadline, now, gapMs)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** La URL de la foto sin la firma que vence (identifica la foto). */
export function pictureKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.slice(0, 500);
  } catch {
    return '';
  }
}

/** Cron: el repaso diario de los números de Lines conectados. `numberIds` lo acota a esos números (como en Inbox). */
export async function refreshLinesDaily(now = new Date(), deadline = Date.now() + 12_000, gapMs = REFRESH_GAP_MS, numberIds?: string[]): Promise<number> {
  const groups = await import('./groups');
  const { storePicture } = await import('./groups-import');
  const { fillLinesNames, learnLinesChatInfo, learnLinesContacts } = await import('./groups-wa-names');
  const db = getDb();
  const only = onlyIds(numberIds);
  const numbers = (await db
    .prepare(`SELECT * FROM groups_numbers WHERE status = 'connected' AND provider IN ('managed', 'evolution', 'waha', 'fake')${only.sql} LIMIT 500`)
    .all(...only.args)) as unknown as import('./groups').NumberRow[];
  if (!numbers.length) return 0;
  await enrollAccounts('lines', numbers.map((x) => ({ id: x.id, userId: x.user_id, later: x.provider === 'fake' })), now);
  let n = 0;
  for (const s of await dueAccounts('lines', numbers.map((x) => x.id), now)) {
    if (Date.now() + 2_000 > deadline) break;
    const number = numbers.find((x) => x.id === s.account_id)!;
    let provider: GroupsProvider;
    try {
      provider = groups.providerFor(number);
    } catch {
      continue;
    }
    if (privacyStale(number.privacy_at, now)) await refreshPrivacy('lines', number.id, provider, now).catch(() => null);
    const target: RefreshTarget = {
      provider,
      learnContacts: (rows) => learnLinesContacts(number, rows),
      fillNames: () => fillLinesNames(number.id),
      chats: async (after, limit) =>
        (
          (await db
            .prepare('SELECT id FROM groups_chats WHERE number_id = ? AND left_at IS NULL AND id > ? ORDER BY id LIMIT ?')
            .all(number.id, after, limit)) as Array<{ id: string }>
        ).map((r) => r.id),
      refreshChat: async (id) => {
        const chat = (await db.prepare('SELECT * FROM groups_chats WHERE id = ? AND number_id = ?').get(id, number.id)) as
          | (import('./groups').ChatRow & { picture_src?: string })
          | undefined;
        if (!chat || !provider.chatInfo) return;
        const info = await provider.chatInfo(chat.provider_chat_id);
        if (!info) return;
        if (chat.kind === 'group') {
          // Asunto y descripción: los de WhatsApp mandan (se cambian allá o desde acá, que los manda a WhatsApp).
          const name = info.name.trim().slice(0, 200);
          if (name && name !== chat.name) await db.prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(name, chat.id);
          const about = info.about.slice(0, 2000);
          if (about !== chat.description) await db.prepare('UPDATE groups_chats SET description = ? WHERE id = ?').run(about, chat.id);
          if (info.participants?.length) await groups.storeMembers(chat.id, info.participants);
        }
        await learnLinesChatInfo(number, chat.provider_chat_id, info);
        // Foto: se baja de nuevo solo si cambió (la guardamos nosotros: la de WhatsApp vence).
        const key = info.pictureUrl ? pictureKey(info.pictureUrl) : '';
        if (key && key !== (chat.picture_src ?? '')) {
          const stored = await storePicture(info.pictureUrl).catch(() => '');
          if (stored) {
            await db.prepare('UPDATE groups_chats SET picture_url = ?, picture_src = ? WHERE id = ?').run(stored, key, chat.id);
            if (chat.picture_url && chat.picture_url !== stored) {
              const { deleteUploads } = await import('./uploads');
              await deleteUploads([chat.picture_url]).catch(() => null);
            }
          }
        }
      },
    };
    if (await refreshAccount('lines', number.id, target, deadline, now, gapMs)) n++;
  }
  return n;
}
