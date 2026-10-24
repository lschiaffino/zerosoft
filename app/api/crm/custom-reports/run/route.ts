import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listReportOwners } from '@/lib/crm-dashboards';
import { runReport, ReportError } from '@/lib/crm-custom-reports';
import { reportRunSchema } from '@/lib/crm-report-builder';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Corre una config (guardada o no) con la visibilidad de quien mira. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = reportRunSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  const owners = await listReportOwners(user, scope);
  try {
    const result = await runReport(user.id, parsed.data.config, {
      scope,
      people: owners.map((o) => ({ id: o.id, name: o.name || o.email })),
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ReportError) return crmError(400, e.code);
    throw e;
  }
}
