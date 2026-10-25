import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listNumbers } from '@/lib/groups';
import { maskPhone } from '@/lib/groups-access';
import { v1Viewer } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/groups/numbers: números conectados (sin credenciales). */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const viewer = await v1Viewer(auth);
  const rows = await listNumbers(auth.user.id);
  return NextResponse.json({
    data: rows.map((n) => ({
      id: n.id,
      name: n.name,
      provider: n.provider,
      phone: viewer.mask && n.phone ? maskPhone(n.phone).replace(/^\+/, '') : n.phone,
      status: n.status,
      caps: n.caps,
      createdAt: n.createdAt,
    })),
  });
}
