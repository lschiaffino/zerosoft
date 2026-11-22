import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import {
  configUsesHidden,
  createCustomReport,
  listCustomReports,
  redactReportConfig,
  ReportError,
  viewerHiddenKeys,
} from '@/lib/crm-custom-reports';
import { reportCreateSchema } from '@/lib/crm-report-builder';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reportes propios del workspace (lib/crm-custom-reports.ts), sin los campos que la persona tiene ocultos. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const isHidden = await viewerHiddenKeys(sessionFieldViewer(user));
  const rows = (await listCustomReports(user.id)).map((r) => ({ ...r, config: redactReportConfig(r.config, isHidden) }));
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = reportCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  // Un campo oculto para la persona no se puede usar (igual que al correr el reporte).
  if (configUsesHidden(parsed.data.config, await viewerHiddenKeys(sessionFieldViewer(user)))) return crmError(400, 'invalid_field');
  try {
    const report = await createCustomReport(user.id, { ...parsed.data, createdBy: realUserId(user) });
    return NextResponse.json(report, { status: 201 });
  } catch (e) {
    if (e instanceof ReportError) return crmError(400, e.code);
    throw e;
  }
}
