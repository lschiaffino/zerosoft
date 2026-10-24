import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { countDueTasks } from '@/lib/crm';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tareas vencidas o de hoy (el número del sidebar), con "hoy" en la zona de
 * la cookie tz. El sidebar lo vuelve a pedir cuando la cookie recién se
 * escribió, en vez de refrescar la página entera.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ count: await countDueTasks(user.id) });
}
