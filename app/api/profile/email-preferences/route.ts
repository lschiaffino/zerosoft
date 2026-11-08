import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getEmailPrefs, saveEmailPrefs } from '@/lib/lifecycle/prefs';
import { recheckSoon } from '@/lib/lifecycle/scheduler';
import { LIFECYCLE_CATEGORIES } from '@/lib/lifecycle/types';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, realUserId } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  unsubscribedAll: z.boolean(),
  optedOut: z.array(z.enum(LIFECYCLE_CATEGORIES)).max(LIFECYCLE_CATEGORIES.length),
  digest: z.boolean(),
});

/** Preferencias de los emails de zerosoft de la persona (Ajustes › Avisos). Los transaccionales no cambian. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await getEmailPrefs(realUserId(user)));
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = realUserId(user);
  const limit = await rateLimit(`email-prefs:${id}`, 60, 600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const saved = await saveEmailPrefs(id, parsed.data);
  // Activar el digest o volver a suscribirse: que el cron la mire en la próxima corrida.
  await recheckSoon(id);
  return NextResponse.json(saved);
}
