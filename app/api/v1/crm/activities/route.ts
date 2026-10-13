import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createActivity, listTimeline } from '@/lib/crm';
import { activityCreateSchema } from '@/lib/crm-schema';
import { ACTIVITY_TYPES, type ActivityType } from '@/lib/crm-constants';
import { catchRef, cleanRow, CrmRefError, zodErrorCode } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Timeline de un registro: notas, llamadas, reuniones, emails y tareas. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const contactId = sp.get('contactId') ?? undefined;
  const companyId = sp.get('companyId') ?? undefined;
  const dealId = sp.get('dealId') ?? undefined;
  if (!contactId && !companyId && !dealId) {
    return apiError(400, 'missing_record', 'Pass contactId, companyId or dealId.');
  }
  const typeParam = sp.get('type');
  const type = (ACTIVITY_TYPES as readonly string[]).includes(typeParam ?? '') ? (typeParam as ActivityType) : undefined;
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? '50') || 50, 1), 200);
  const rows = await listTimeline(auth.user.id, { contactId, companyId, dealId, type, limit, ownerScope: await apiScope(auth) });
  return NextResponse.json({ activities: rows.map(cleanRow) });
}

/** Registrar una nota, llamada, reunión o email (las tareas van por /crm/tasks). */
const v1ActivitySchema = activityCreateSchema.extend({
  type: z.enum(['note', 'call', 'meeting', 'email']),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const body: unknown = await req.json().catch(() => null);
  const parsed = v1ActivitySchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const { contactId, companyId, dealId } = parsed.data;
  if (!contactId && !companyId && !dealId) {
    return apiError(400, 'missing_record', 'Pass contactId, companyId or dealId.');
  }
  const activity = await catchRef(createActivity(auth.user.id, parsed.data));
  if (activity instanceof CrmRefError) return apiError(400, activity.code, 'A referenced record does not exist.');
  return NextResponse.json(cleanRow(activity), { status: 201 });
}
