import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getCurrentUser } from '@/lib/session';
import { createFeedback, notifyFeedback, parseFeedback } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

/**
 * Feedback público (app y sitio). Sin sesión acepta un email opcional; con
 * sesión se asocia a la persona logueada. El honeypot responde 200 sin guardar
 * (al bot no le decimos que lo detectamos).
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'feedback', 5, 600);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = parseFeedback(raw);
  if (!parsed.ok) {
    if (parsed.error === 'spam') return NextResponse.json({ ok: true });
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // El feedback nunca debe fallar por la sesión.
  const user = await getCurrentUser().catch(() => null);
  const person = user?.actingUser ?? user;
  const { kind, product, message, email, pageUrl } = parsed.data;

  const row = await createFeedback({
    kind,
    product,
    message,
    email: person?.email ?? email ?? null,
    userId: person?.id ?? null,
    pageUrl: pageUrl ?? req.headers.get('referer'),
    userAgent: req.headers.get('user-agent'),
  });
  await notifyFeedback(row);

  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}
