import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { createLabel, listLabels } from '@/lib/groups';
import { v1Error, v1Json } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/groups/labels */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  return NextResponse.json({ data: await listLabels(auth.user.id) });
}

/** POST /api/v1/groups/labels { name, color? } */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const b = await v1Json(req);
  try {
    return NextResponse.json({ data: await createLabel(auth.user.id, { name: typeof b.name === 'string' ? b.name : '', color: typeof b.color === 'string' ? b.color : undefined }) }, { status: 201 });
  } catch (err) {
    return v1Error(err);
  }
}
