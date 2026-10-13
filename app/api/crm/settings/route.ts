import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getCrmSettings, updateCrmSettings } from '@/lib/crm-currency';
import { crmSettingsSchema } from '@/lib/crm-schema';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(await getCrmSettings(user.id));
}

/** Moneda base y comportamiento de quotes del workspace (solo admins). */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = crmSettingsSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await updateCrmSettings(user.id, parsed.data));
  } catch {
    return crmError(400, 'invalid_currency');
  }
}
