import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { MAX_BULK_GROUPS, createGroups, type CreateGroupRow } from '@/lib/groups';
import { v1Error, v1Json } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/v1/groups/groups: crea uno o varios grupos de WhatsApp desde un
 * número WAHA o Evolution. { numberId, name, phones, description?, admins?, labelIds? }
 * o { numberId, groups: [ ...lo mismo ] } (hasta 50).
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const b = await v1Json(req);
  if (typeof b.numberId !== 'string') return apiError(400, 'invalid_input', 'numberId is required.');
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const toRow = (r: Record<string, unknown>): CreateGroupRow => ({
    name: typeof r.name === 'string' ? r.name : '',
    phones: arr(r.phones),
    description: typeof r.description === 'string' ? r.description : undefined,
    admins: arr(r.admins),
    labelIds: arr(r.labelIds),
  });
  const rows = Array.isArray(b.groups) ? (b.groups as Array<Record<string, unknown>>).slice(0, MAX_BULK_GROUPS).map(toRow) : [toRow(b)];
  try {
    const results = await createGroups(auth.user.id, b.numberId, rows);
    return NextResponse.json({ data: results }, { status: results.some((r) => r.ok) ? 201 : 400 });
  } catch (err) {
    return v1Error(err);
  }
}
