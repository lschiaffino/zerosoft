import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { defaultSenderFor, enrollContacts } from '@/lib/crm-sequences';
import { enrollSchema } from '@/lib/crm-email-schema';
import { limitAction, zodErrorCode } from '@/lib/crm-http';
import { apiScope, visibleIds } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  not_found: 'Sequence not found.',
  gmail_not_connected: 'The sender has no Gmail or Outlook account connected with send permission.',
  no_steps: 'The sequence has no steps.',
  incomplete_steps: 'Every email step needs a body or a template.',
  invalid_sender: 'senderId is not a member of this workspace.',
};

/**
 * Inscribe contactos. senderId (opcional) = persona del workspace cuyo Gmail
 * envía. Solo el owner o un admin elige otro remitente (por defecto el owner
 * del primer contacto o quien creó la secuencia); un member envía siempre
 * desde su propio Gmail, como en la app. Los contactos que la key no ve con la
 * visibilidad del CRM se saltean como not_found.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const limited = await limitAction(auth.personId, 'enroll', 60, 3600);
  if (limited) return limited;
  const body: unknown = await req.json().catch(() => null);
  const parsed = enrollSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const admin = auth.role === 'owner' || auth.role === 'admin';
  if (!admin && parsed.data.senderId && parsed.data.senderId !== auth.personId) {
    return apiError(403, 'sender_not_allowed', 'Only the workspace owner or an admin can send from another person’s mailbox.');
  }
  const contactIds = [...new Set(parsed.data.contactIds)];
  const visible = new Set(await visibleIds(auth.user.id, 'crm_contacts', contactIds, await apiScope(auth)));
  const allowed = contactIds.filter((c) => visible.has(c));
  const hidden = contactIds.filter((c) => !visible.has(c));
  const senderId = admin ? (parsed.data.senderId ?? (await defaultSenderFor(auth.user.id, id, allowed[0] ?? ''))) : auth.personId;
  const res = await enrollContacts(auth.user.id, { sequenceId: id, contactIds: allowed, senderId, enrolledBy: auth.personId });
  if (!res.ok) return apiError(res.error === 'not_found' ? 404 : 400, res.error, MESSAGES[res.error] ?? res.error);
  const skipped = [...res.skipped, ...hidden.map((contactId) => ({ contactId, reason: 'not_found' as const }))];
  return NextResponse.json({ enrolled: res.enrolled, skipped }, { status: 201 });
}
