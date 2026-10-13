import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getMemberVisibility, setMemberVisibility } from '@/lib/crm-visibility';
import { visibilitySchema } from '@/lib/crm-schema';
import { forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ visibility: await getMemberVisibility(user.id) });
}

/** Qué registros ven los members (admins y owner siempre ven todo). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = visibilitySchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json({ visibility: await setMemberVisibility(user.id, parsed.data.visibility) });
}
