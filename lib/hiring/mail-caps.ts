/**
 * Hiring: topes de los emails a candidatos. Salen con la dirección de la app
 * (la misma de los códigos de acceso), llevan texto del workspace y el acuse lo
 * dispara cualquiera desde la página de empleos con el email que quiera: sin
 * tope, sería una forma de mandar spam con nuestro dominio. Server-only.
 */
import { createHash } from 'crypto';
import { getDb } from '../db';
import { rateLimit } from '../rate-limit';

const DAY = 86_400;

export const MAIL_CAPS = {
  /** Mismo workspace, misma dirección, por día. */
  recipient: 10,
  /** Acuses a una misma dirección por workspace, por día (los dispara alguien sin sesión). */
  ackRecipient: 1,
  /** Una dirección desde todos los workspaces, por día. */
  recipientGlobal: 30,
  /** Por workspace, por día. */
  workspace: 500,
  /** Por workspace con menos de newDays días, por día. */
  newWorkspace: 80,
  newDays: 14,
};

export type MailCapCode = 'recipient_limit' | 'workspace_limit';

/** Reserva un envío. Devuelve el motivo si no corresponde mandarlo. */
export async function reserveCandidateMail(ws: string, email: string, kind: string): Promise<MailCapCode | null> {
  const to = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  const owner = (await getDb().prepare('SELECT created_at FROM users WHERE id = ?').get(ws)) as { created_at: string | null } | undefined;
  const created = owner?.created_at ? Date.parse(owner.created_at.includes('T') ? owner.created_at : `${owner.created_at.replace(' ', 'T')}Z`) : 0;
  const fresh = Number.isFinite(created) && Date.now() - created < MAIL_CAPS.newDays * DAY * 1000;
  if (!(await rateLimit(`hiring:mail:ws:${ws}`, fresh ? MAIL_CAPS.newWorkspace : MAIL_CAPS.workspace, DAY)).ok) return 'workspace_limit';
  if (kind === 'ack' && !(await rateLimit(`hiring:mail:ack:${ws}:${to}`, MAIL_CAPS.ackRecipient, DAY)).ok) return 'recipient_limit';
  if (!(await rateLimit(`hiring:mail:to:${ws}:${to}`, MAIL_CAPS.recipient, DAY)).ok) return 'recipient_limit';
  if (!(await rateLimit(`hiring:mail:global:${to}`, MAIL_CAPS.recipientGlobal, DAY)).ok) return 'recipient_limit';
  return null;
}
