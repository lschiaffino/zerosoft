import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createCustomReport, listCustomReports, ReportError } from '@/lib/crm-custom-reports';
import { reportCreateSchema } from '@/lib/crm-report-builder';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reportes propios del workspace (lib/crm-custom-reports.ts). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listCustomReports(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = reportCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const report = await createCustomReport(user.id, { ...parsed.data, createdBy: realUserId(user) });
    return NextResponse.json(report, { status: 201 });
  } catch (e) {
    if (e instanceof ReportError) return crmError(400, e.code);
    throw e;
  }
}
