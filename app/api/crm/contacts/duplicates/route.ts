import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { findDuplicateContacts } from '@/lib/crm';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ groups: await findDuplicateContacts(user.id) });
}
