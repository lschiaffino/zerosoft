import { NextResponse } from 'next/server';
import { limitByIp, rateLimit } from '@/lib/rate-limit';
import { getCurrentUser } from '@/lib/session';
import { joinedApps, joinWaitlist, normalizeLang, sendWaitlistJoined, WaitlistError } from '@/lib/waitlist';
import { noStore } from '@/lib/no-store';

export const dynamic = 'force-dynamic';

/** GET: apps "Próximamente" en cuya lista ya está la persona logueada. */
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  const person = user?.actingUser ?? user;
  return noStore(NextResponse.json({ apps: person ? await joinedApps(person.email) : [] }));
}

/**
 * POST { app, useCase?, email?, locale?, website? }: sumarse a la lista de
 * espera. Con sesión vale el email de la sesión (un clic); sin sesión, el del
 * formulario del sitio. Repetirlo no duplica: el email de confirmación sale
 * solo la primera vez. `website` es el honeypot: responde ok sin guardar.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'waitlist', 10, 600);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (typeof body.website === 'string' && body.website.trim()) return NextResponse.json({ ok: true, created: false });
  const user = await getCurrentUser().catch(() => null);
  const person = user?.actingUser ?? user;
  const locale = normalizeLang(body.locale);
  try {
    const res = await joinWaitlist({
      app: String(body.app ?? ''),
      email: person?.email ?? body.email,
      userId: person?.id ?? null,
      useCase: body.useCase,
      locale,
      source: person ? 'app' : 'site',
    });
    // Desde el sitio cualquiera escribe cualquier email: a lo sumo 3 confirmaciones por día a la misma dirección.
    const mailOk = person ? true : (await rateLimit(`waitlist:mail:${res.email}`, 3, 86400)).ok;
    if (res.created && mailOk) await sendWaitlistJoined(res.email, res.app, locale).catch(() => false);
    return NextResponse.json({ ok: true, created: res.created, app: res.app, ...(person ? { email: res.email } : {}) });
  } catch (err) {
    if (err instanceof WaitlistError) return NextResponse.json({ error: err.code }, { status: 400 });
    throw err;
  }
}
