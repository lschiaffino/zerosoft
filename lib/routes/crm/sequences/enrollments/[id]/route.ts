import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getEnrollment, SENDER_LEFT, setEnrollmentState } from '@/lib/crm-sequences';
import { enrollmentActionSchema } from '@/lib/crm-email-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { canSeeRecord, sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pausar / reanudar / sacar a un contacto de la secuencia. La inscripción de
 * un contacto que la persona no ve con la visibilidad del CRM no existe para ella.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = enrollmentActionSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const current = await getEnrollment(user.id, id);
  if (!current || !(await canSeeRecord(user.id, 'crm_contacts', current.contact_id, await sessionScope(user)))) return notFound();
  const enr = await setEnrollmentState(user.id, id, parsed.data.action);
  if (!enr) return notFound();
  // Quien enviaba ya no es del workspace: no se reanuda (se quita y se inscribe con otra persona).
  if (parsed.data.action === 'resume' && enr.status === 'paused' && enr.exit_reason === SENDER_LEFT) return crmError(409, SENDER_LEFT);
  return NextResponse.json(enr);
}
