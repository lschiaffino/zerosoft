import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Event types activos del usuario (para el menú "Book meeting" del CRM). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const rows = await listEventTypes(user.id, { activeOnly: true });
  return NextResponse.json({
    rows: rows.map((et) => ({
      slug: et.slug,
      title: et.title,
      durationMin: et.duration_min,
      path: `/book/${user.handle}/${et.slug}`,
    })),
  });
}
