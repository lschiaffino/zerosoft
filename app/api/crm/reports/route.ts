import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createSavedReport, deleteSavedReport, listSavedReports } from '@/lib/crm';
import { savedReportCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const reportType = req.nextUrl.searchParams.get('reportType');
  const rows = await listSavedReports(user.id);
  const filtered = reportType ? rows.filter((r) => r.report_type === reportType) : rows;
  return NextResponse.json({ rows: filtered });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = savedReportCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const report = await createSavedReport(user.id, parsed.data);
  return NextResponse.json(report, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return crmError(400, 'invalid_input');

  const ok = await deleteSavedReport(user.id, id);
  if (!ok) return crmError(404, 'not_found');
  return new NextResponse(null, { status: 204 });
}
