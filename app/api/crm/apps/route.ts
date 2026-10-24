import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listApps } from '@/lib/crm-apps';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado de las apps del CRM (sin secretos: solo pistas enmascaradas). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ apps: await listApps(user.id) });
}
