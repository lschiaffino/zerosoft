import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { setAvailability } from '@/lib/crm-assignment';
import { availabilitySchema } from '@/lib/crm-schema';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fuera de oficina: cada persona marca la suya; los admins, la de cualquiera. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = availabilitySchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  if (parsed.data.personId !== realUserId(user) && !isWorkspaceAdmin(user)) return forbidden();
  if (!(await setAvailability(user.id, parsed.data.personId, parsed.data.available))) {
    return crmError(400, 'invalid_owner');
  }
  return NextResponse.json({ ok: true });
}
