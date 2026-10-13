import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { listQuotas, quotaProgress, QuotaError, upsertQuota } from '@/lib/crm-quotas';
import { quotaUpsertSchema } from '@/lib/crm-schema';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cuotas y su progreso en el período actual (respeta la visibilidad por owner). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const [quotas, progress] = await Promise.all([
    listQuotas(user.id),
    quotaProgress(user.id, { ownerIds: scope }),
  ]);
  return NextResponse.json({ quotas: quotas.filter((q) => !scope || scope.includes(q.person_id)), progress });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = quotaUpsertSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await upsertQuota(user.id, parsed.data));
  } catch (e) {
    if (e instanceof QuotaError) return crmError(400, e.code);
    throw e;
  }
}
