import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { ForecastError, submissionHistory, submitForecast } from '@/lib/crm-forecast';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const periodSchema = z.enum(['month', 'quarter']);
const submitSchema = z.object({
  personId: z.string().min(1).max(64),
  period: periodSchema,
  periodLabel: z.string().min(6).max(10),
  amount: z.number().min(0).max(1e12),
  note: z.string().max(500).optional(),
});

/** Historial de envíos: ?personId&period&label. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const personId = sp.get('personId') ?? '';
  const period = periodSchema.safeParse(sp.get('period'));
  const label = sp.get('label') ?? '';
  if (!personId || !period.success || !label) return crmError(400, 'invalid_input');
  const scope = await sessionScope(user);
  if (!canSeeOwner(scope, personId, user.id)) return crmError(404, 'not_found');
  return NextResponse.json({ rows: await submissionHistory(user.id, personId, period.data, label) });
}

/** Envía el número de forecast: cada persona el suyo; un admin, el de cualquiera. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  if (parsed.data.personId !== realUserId(user) && !isWorkspaceAdmin(user)) return forbidden();
  const scope = await sessionScope(user);
  if (!canSeeOwner(scope, parsed.data.personId, user.id)) return crmError(404, 'not_found');
  try {
    const row = await submitForecast(user.id, { ...parsed.data, submittedBy: user.actingUser?.email ?? user.email });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof ForecastError) return crmError(400, e.code);
    throw e;
  }
}
