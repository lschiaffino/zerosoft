import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { countDueTasks } from '@/lib/crm';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tareas vencidas o de hoy (el número del sidebar), con "hoy" en la zona de
 * la cookie tz. El sidebar lo vuelve a pedir cuando la cookie recién se
 * escribió, en vez de refrescar la página entera. Como el badge del layout,
 * un error (p. ej. sin la tabla) devuelve 0 y queda en el log, no un 500.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const count = await countDueTasks(user.id).catch((err: unknown) => {
    console.error('[crm due-count]', err);
    return 0;
  });
  return NextResponse.json({ count });
}
