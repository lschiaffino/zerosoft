import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getEmailSettings, setEmailSettings } from '@/lib/crm-email';
import { emailSettingsSchema } from '@/lib/crm-email-schema';
import { forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(await getEmailSettings(user.id));
}

/** Tracking de aperturas/clicks del workspace (solo admins). */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = emailSettingsSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  await setEmailSettings(user.id, parsed.data);
  return NextResponse.json(await getEmailSettings(user.id));
}
