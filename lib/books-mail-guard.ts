/**
 * Books: topes de lo que sale por email hacia afuera desde el remitente
 * compartido. Por workspace y por destinatario, más bajos en cuentas nuevas.
 * Los recordatorios del cron ya van reclamados por factura y no pasan por acá.
 */
import { getDb } from './db';
import { rateLimit } from './rate-limit';
import { BooksError } from './books-schema';

const DAY = 86_400;
const NEW_ACCOUNT_DAYS = 7;
export const BOOKS_MAIL_LIMITS = { workspaceDay: 300, newWorkspaceDay: 20, recipientDay: 8 };

export async function isNewBooksAccount(ws: string): Promise<boolean> {
  const u = (await getDb().prepare('SELECT created_at FROM users WHERE id = ?').get(ws)) as { created_at?: string } | undefined;
  if (!u?.created_at) return true;
  const t = Date.parse(`${u.created_at.replace(' ', 'T')}${u.created_at.includes('Z') ? '' : 'Z'}`);
  return !Number.isFinite(t) || Date.now() - t < NEW_ACCOUNT_DAYS * DAY * 1000;
}

/** Corta con `email_limit` (429) si el workspace o el destinatario ya llegaron al tope del día. */
export async function assertBooksMailAllowed(ws: string, to: string): Promise<void> {
  const fresh = await isNewBooksAccount(ws);
  const perRecipient = await rateLimit(`books-mail:r:${ws}:${to.toLowerCase()}`, BOOKS_MAIL_LIMITS.recipientDay, DAY);
  if (!perRecipient.ok) throw new BooksError('email_limit', 429);
  const perWs = await rateLimit(`books-mail:w:${ws}`, fresh ? BOOKS_MAIL_LIMITS.newWorkspaceDay : BOOKS_MAIL_LIMITS.workspaceDay, DAY);
  if (!perWs.ok) throw new BooksError('email_limit', 429);
}

/**
 * Texto libre en un email a alguien de afuera: solo cuentas con antigüedad y
 * solo a un email que ya es de un contacto del workspace. Una cuenta recién
 * creada no puede usar nuestro remitente para mandarle un texto propio a
 * cualquier dirección.
 */
export async function freeTextAllowed(ws: string, to: string): Promise<boolean> {
  if (await isNewBooksAccount(ws)) return false;
  const known = await getDb().prepare('SELECT 1 AS x FROM books_contacts WHERE workspace_id = ? AND LOWER(email) = ? LIMIT 1').get(ws, to.toLowerCase());
  return Boolean(known);
}
