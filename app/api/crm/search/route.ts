import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { redactRowsFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { searchAll } from '@/lib/crm';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json({ contacts: [], companies: [], deals: [] });
  const res = await searchAll(user.id, q, await sessionScope(user));
  // Las filas van enteras: sin los campos propios que la persona tiene ocultos.
  const viewer = sessionFieldViewer(user);
  return NextResponse.json({
    contacts: await redactRowsFor(viewer, 'contacts', res.contacts),
    companies: await redactRowsFor(viewer, 'companies', res.companies),
    deals: await redactRowsFor(viewer, 'deals', res.deals),
  });
}
