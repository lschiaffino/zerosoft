import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { enrollContacts } from '@/lib/crm-sequences';
import { enrollSchema } from '@/lib/crm-email-schema';
import { crmError, invalidBody, limitAction, unauthorized } from '@/lib/crm-http';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inscribe contactos (detalle del contacto o acción masiva de la lista).
 * Los emails salen del Gmail de quien inscribe: sin Gmail conectado con
 * permiso de envío responde 400 gmail_not_connected. Los contactos que la
 * persona no ve con la visibilidad del CRM se saltean como not_found.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const limited = await limitAction(realUserId(user), 'enroll', 60, 3600);
  if (limited) return limited;
  const body: unknown = await req.json().catch(() => null);
  const parsed = enrollSchema.omit({ senderId: true }).safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const contactIds = [...new Set(parsed.data.contactIds)];
  const visible = new Set(await visibleIds(user.id, 'crm_contacts', contactIds, await sessionScope(user)));
  const res = await enrollContacts(user.id, {
    sequenceId: id,
    contactIds: contactIds.filter((c) => visible.has(c)),
    senderId: realUserId(user),
    enrolledBy: realUserId(user),
  });
  if (!res.ok) return crmError(res.error === 'not_found' ? 404 : 400, res.error);
  const hidden = contactIds.filter((c) => !visible.has(c)).map((contactId) => ({ contactId, reason: 'not_found' as const }));
  return NextResponse.json({ ...res, skipped: [...res.skipped, ...hidden] }, { status: 201 });
}
