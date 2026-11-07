/**
 * Shop: topes e idempotencia de todo email que sale a un cliente. Cualquiera
 * puede escribir cualquier dirección en un checkout, y el remitente es el de
 * la app: sin esto, una tienda recién creada serviría para mandar correo a
 * terceros. Cada envío reclama su fila (workspace, tipo, referencia); dos
 * corridas de la misma cosa mandan uno solo. Server-only.
 */
import { getDb } from './db';
import { newId, nowDb } from './shop';

/** Transaccional: lo que el cliente pidió al comprar. Recordatorio: lo que la tienda inicia. */
export type ShopEmailKind = 'order_confirmation' | 'order_pending' | 'order_shipped' | 'invoice' | 'abandoned' | 'account_link';

const REMINDER_KINDS = new Set<ShopEmailKind>(['abandoned', 'invoice']);

export const SHOP_EMAIL_CAPS = {
  /** Por destinatario, en una tienda, en 24 horas. */
  recipientStoreDay: 10,
  /** Por destinatario, sumando todas las tiendas, en 24 horas. */
  recipientGlobalDay: 25,
  /** Recordatorios por destinatario en una tienda, en 7 días. */
  reminderRecipientStoreWeek: 2,
  /** Recordatorios por destinatario, sumando todas las tiendas, en 24 horas. */
  reminderRecipientGlobalDay: 3,
  /** Por tienda, en 24 horas. */
  storeDay: 2000,
  /** Cuenta nueva: los primeros días. */
  newAccountDay: 50,
  newAccountReminderDay: 10,
  newAccountDays: 7,
} as const;

export type GuardResult = { ok: true; id: string } | { ok: false; reason: 'duplicate' | 'recipient_cap' | 'store_cap' | 'new_account_cap' | 'opted_out' };

function hoursAgo(h: number, now: Date): string {
  return nowDb(new Date(now.getTime() - h * 3_600_000));
}

async function count(sql: string, ...args: Array<string | number>): Promise<number> {
  const row = (await getDb().prepare(sql).get(...args)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

async function accountIsNew(ws: string, now: Date): Promise<boolean> {
  const row = (await getDb().prepare('SELECT created_at FROM shop_stores WHERE workspace_id = ?').get(ws)) as { created_at: string } | undefined;
  if (!row) return true;
  const t = Date.parse(`${row.created_at.replace(' ', 'T')}Z`);
  return Number.isNaN(t) || now.getTime() - t < SHOP_EMAIL_CAPS.newAccountDays * 86_400_000;
}

export async function isOptedOut(ws: string, email: string): Promise<boolean> {
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM shop_email_optouts WHERE workspace_id = ? AND email = ?').get(ws, email.trim().toLowerCase()));
}

export async function optOut(ws: string, email: string): Promise<void> {
  await getDb().prepare('INSERT OR IGNORE INTO shop_email_optouts (workspace_id, email, created_at) VALUES (?, ?, ?)').run(ws, email.trim().toLowerCase(), nowDb());
}

/**
 * Reclama el envío: chequea los topes y deja la fila (idempotencia). Con ok,
 * el que llama manda el email; si el proveedor falla, `releaseEmailClaim`
 * permite reintentar sin pasar el tope.
 */
export async function claimShopEmail(ws: string, recipient: string, kind: ShopEmailKind, ref: string, now: Date = new Date()): Promise<GuardResult> {
  const to = recipient.trim().toLowerCase();
  const db = getDb();
  if (await db.prepare('SELECT 1 AS x FROM shop_email_log WHERE workspace_id = ? AND kind = ? AND ref = ?').get(ws, kind, ref)) return { ok: false, reason: 'duplicate' };
  const reminder = REMINDER_KINDS.has(kind);
  if (kind === 'abandoned' && (await isOptedOut(ws, to))) return { ok: false, reason: 'opted_out' };
  const day = hoursAgo(24, now);
  if ((await count('SELECT COUNT(*) AS n FROM shop_email_log WHERE workspace_id = ? AND recipient = ? AND created_at >= ?', ws, to, day)) >= SHOP_EMAIL_CAPS.recipientStoreDay) return { ok: false, reason: 'recipient_cap' };
  if ((await count('SELECT COUNT(*) AS n FROM shop_email_log WHERE recipient = ? AND created_at >= ?', to, day)) >= SHOP_EMAIL_CAPS.recipientGlobalDay) return { ok: false, reason: 'recipient_cap' };
  if (reminder) {
    const kinds = "('abandoned', 'invoice')";
    if ((await count(`SELECT COUNT(*) AS n FROM shop_email_log WHERE workspace_id = ? AND recipient = ? AND kind IN ${kinds} AND created_at >= ?`, ws, to, hoursAgo(24 * 7, now))) >= SHOP_EMAIL_CAPS.reminderRecipientStoreWeek) return { ok: false, reason: 'recipient_cap' };
    if ((await count(`SELECT COUNT(*) AS n FROM shop_email_log WHERE recipient = ? AND kind IN ${kinds} AND created_at >= ?`, to, day)) >= SHOP_EMAIL_CAPS.reminderRecipientGlobalDay) return { ok: false, reason: 'recipient_cap' };
  }
  const storeToday = await count('SELECT COUNT(*) AS n FROM shop_email_log WHERE workspace_id = ? AND created_at >= ?', ws, day);
  if (storeToday >= SHOP_EMAIL_CAPS.storeDay) return { ok: false, reason: 'store_cap' };
  if (await accountIsNew(ws, now)) {
    if (storeToday >= SHOP_EMAIL_CAPS.newAccountDay) return { ok: false, reason: 'new_account_cap' };
    if (reminder && (await count(`SELECT COUNT(*) AS n FROM shop_email_log WHERE workspace_id = ? AND kind IN ('abandoned', 'invoice') AND created_at >= ?`, ws, day)) >= SHOP_EMAIL_CAPS.newAccountReminderDay) return { ok: false, reason: 'new_account_cap' };
  }
  const id = newId('mail');
  const res = await db.prepare('INSERT OR IGNORE INTO shop_email_log (id, workspace_id, recipient, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, ws, to, kind, ref, nowDb(now));
  if (!res.changes) return { ok: false, reason: 'duplicate' };
  return { ok: true, id };
}

/** El proveedor falló: la fila se libera para poder reintentar. */
export async function releaseEmailClaim(id: string): Promise<void> {
  await getDb().prepare('DELETE FROM shop_email_log WHERE id = ?').run(id);
}
