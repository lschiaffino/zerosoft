import { NextResponse } from 'next/server';
import { DEMO_EMAIL, DEMO_MODE, getCurrentUser, realUserId } from '@/lib/session';
import { getUserById } from '@/lib/db';
import { exportAccountData } from '@/lib/privacy';
import { recordSecurityEvent } from '@/lib/account-security';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * "Descargar mis datos" (GDPR arts. 15 y 20): un zip con un JSON por tabla de todo lo de la
 * cuenta y del workspace propio, sin secretos. Siempre de la persona real, nunca del
 * workspace ajeno en el que esté.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const me = await getUserById(realUserId(user));
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (DEMO_MODE && me.email === DEMO_EMAIL) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const limit = await rateLimit(`account-export:${me.id}`, 5, 3600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const { zip, tables, rows } = await exportAccountData(me);
  await recordSecurityEvent({ userId: me.id, action: 'export.account', meta: { tables, rows } });
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="zerosoft-data-${new Date().toISOString().slice(0, 10)}.zip"`,
      'cache-control': 'no-store',
    },
  });
}
