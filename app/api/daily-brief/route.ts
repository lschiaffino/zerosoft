import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { delegatedIdentity } from '@/lib/mcp/identity';
import { limitWrites } from '@/lib/write-limit';
import { briefEmailOn, setBriefEmail } from '@/lib/daily-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

/** El email del resumen del día (Ajustes › Avisos): de la persona real, en cualquier workspace. Nunca con un token delegado. */
async function person(): Promise<string | NextResponse> {
  if (delegatedIdentity()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return realUserId(user);
}

export async function GET() {
  const me = await person();
  if (me instanceof NextResponse) return me;
  return NextResponse.json({ email: await briefEmailOn(me) }, { headers: NO_STORE });
}

/** { email: boolean, timeZone?: string } (la zona del navegador: el email sale a su mañana). */
export async function PATCH(req: Request) {
  const me = await person();
  if (me instanceof NextResponse) return me;
  const limited = await limitWrites('settings', me);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { email?: unknown; timeZone?: unknown } | null;
  if (typeof b?.email !== 'boolean') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  await setBriefEmail(me, b.email, typeof b.timeZone === 'string' ? b.timeZone : '');
  return NextResponse.json({ email: b.email }, { headers: NO_STORE });
}
