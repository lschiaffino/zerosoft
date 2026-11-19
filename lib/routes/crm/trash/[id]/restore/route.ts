import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { restoreTrash } from '@/lib/crm-trash';
import { crmError, notFound, unauthorized } from '@/lib/crm-http';
import { CONTACT_EMAIL_TAKEN, emailTakenInfo } from '@/lib/crm-contact-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Restaura una entrada de la papelera (registro, asociaciones y actividades propias). */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const res = await restoreTrash(user.id, params.id, scope);
  // Otro contacto tomó el email mientras tanto: 409 y el existente solo si quien pide lo ve.
  if (!res.ok && res.reason === 'email_taken') {
    return NextResponse.json({ error: CONTACT_EMAIL_TAKEN, ...emailTakenInfo(res.existing, scope) }, { status: 409 });
  }
  if (!res.ok) return res.reason === 'conflict' ? crmError(409, 'trash_conflict') : notFound();
  return NextResponse.json(res);
}
