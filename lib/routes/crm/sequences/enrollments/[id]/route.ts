import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { setEnrollmentState } from '@/lib/crm-sequences';
import { enrollmentActionSchema } from '@/lib/crm-email-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pausar / reanudar / sacar a un contacto de la secuencia. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = enrollmentActionSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const enr = await setEnrollmentState(user.id, id, parsed.data.action);
  return enr ? NextResponse.json(enr) : notFound();
}
