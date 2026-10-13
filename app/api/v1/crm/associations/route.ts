import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { associate, dissociate, listAssociations, type AssocObject } from '@/lib/crm-assoc';
import { associationRemoveSchema, associationSchema } from '@/lib/crm-schema';
import { catchRef, CrmRefError, zodErrorCode } from '@/lib/crm-http';
import { apiScope, canSeeBoth, canSeeEntity, scopeAssociationList } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: readonly AssocObject[] = ['contact', 'company', 'deal'];

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') as AssocObject | null;
  const id = sp.get('id');
  if (!type || !TYPES.includes(type) || !id) {
    return apiError(400, 'invalid_input', 'Pass type (contact, company or deal) and id.');
  }
  const scope = await apiScope(auth);
  if (!(await canSeeEntity(auth.user.id, type, id, scope))) return apiError(404, 'not_found', 'Record not found.');
  const list = await listAssociations(auth.user.id, type, id);
  if (!list) return apiError(404, 'not_found', 'Record not found.');
  return NextResponse.json(await scopeAssociationList(auth.user.id, list, scope));
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = associationSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  if (!(await canSeeBoth(auth.user.id, parsed.data, await apiScope(auth)))) return apiError(404, 'not_found', 'Record not found.');
  const res = await catchRef(associate(auth.user.id, parsed.data));
  if (res instanceof CrmRefError) return apiError(400, res.code, 'The association is not valid.');
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const parsed = associationRemoveSchema.safeParse({
    fromType: sp.get('fromType'),
    fromId: sp.get('fromId'),
    toType: sp.get('toType'),
    toId: sp.get('toId'),
  });
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'Pass fromType, fromId, toType and toId.');

  if (!(await canSeeBoth(auth.user.id, parsed.data, await apiScope(auth)))) return apiError(404, 'not_found', 'Record not found.');
  const removed = await catchRef(dissociate(auth.user.id, parsed.data));
  if (removed instanceof CrmRefError) return apiError(400, removed.code, 'The association is not valid.');
  if (!removed) return apiError(404, 'not_found', 'Association not found.');
  return new NextResponse(null, { status: 204 });
}
