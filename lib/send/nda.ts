/**
 * Send y Sign: el acuerdo antes de ver un link. Cada persona firma su propio sobre
 * desde una plantilla de Sign con un solo firmante, en la sala de firma de siempre
 * (con su código por email si la plantilla lo pide). Recién con el sobre firmado la
 * sesión pasa el paso. Server-only.
 */
import { getDb } from '../db';
import { listRecipients, recipientToken } from '../sign/core';
import { envelopeFromTemplate, getTemplate } from '../sign/templates';
import { SignError, type SignActor } from '../sign/types';
import type { LinkRow } from './core';
import type { SessionRow } from './viewer';
import { nowIso, SendError } from './types';

function actorOf(link: LinkRow): SignActor {
  return { ws: link.workspace_id, person: link.created_by, admin: true, email: '', name: '' };
}

export async function startNda(link: LinkRow, session: SessionRow, name: string, locale: string): Promise<{ signPath: string }> {
  if (!link.nda_template_id) throw new SendError('not_on_this_step', 409);
  if (!session.email) throw new SendError('email_required', 400);
  // Nunca un sobre a nombre de un email sin probar: el link de firma le daría la firma de otro.
  if (!session.email_verified) throw new SendError('not_on_this_step', 409);
  const db = getDb();
  const actor = actorOf(link);
  try {
    if (session.nda_envelope_id) {
      const rec = (await listRecipients(session.nda_envelope_id)).find((r) => r.email === session.email);
      if (rec) return { signPath: `/${locale}/sign/${await recipientToken(rec)}` };
    }
    const tpl = await getTemplate(actor, link.nda_template_id);
    const roles = JSON.parse(tpl.roles || '[]') as Array<{ key: string; role: string }>;
    const signers = roles.filter((r) => r.role !== 'cc');
    if (signers.length !== 1 || roles.length !== 1) throw new SendError('nda_template_invalid', 409);
    const env = await envelopeFromTemplate(actor, tpl.id, { recipients: { [signers[0].key]: { name: name.trim().slice(0, 120), email: session.email } }, send: true, locale });
    await db.prepare('UPDATE send_sessions SET nda_envelope_id = ? WHERE id = ?').run(env.id, session.id);
    const rec = (await listRecipients(env.id))[0];
    return { signPath: `/${locale}/sign/${await recipientToken(rec)}` };
  } catch (err) {
    if (err instanceof SignError) throw new SendError('nda_unavailable', 409);
    throw err;
  }
}

/** ¿Ya firmó? Se mira el sobre: la sesión no se marca por lo que diga el navegador. */
export async function checkNda(session: SessionRow): Promise<boolean> {
  if (session.nda_signed_at) return true;
  if (!session.nda_envelope_id) return false;
  const rec = (await listRecipients(session.nda_envelope_id)).find((r) => r.email === session.email);
  if (!rec || (rec.status !== 'signed' && rec.status !== 'completed')) return false;
  const res = await getDb().prepare('UPDATE send_sessions SET nda_signed_at = ? WHERE id = ? AND email = ? AND nda_envelope_id = ?').run(nowIso(), session.id, session.email, session.nda_envelope_id);
  return res.changes > 0;
}
