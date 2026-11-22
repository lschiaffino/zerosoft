import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import {
  configUsesHidden,
  deleteCustomReport,
  getCustomReport,
  redactReportConfig,
  ReportError,
  updateCustomReport,
  viewerHiddenKeys,
} from '@/lib/crm-custom-reports';
import { reportPatchSchema } from '@/lib/crm-report-builder';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La config sale sin los campos que la persona tiene ocultos (ni su nombre ni el valor de un filtro). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const report = await getCustomReport(user.id, id);
  if (!report) return notFound();
  const isHidden = await viewerHiddenKeys(sessionFieldViewer(user));
  return NextResponse.json({ ...report, config: redactReportConfig(report.config, isHidden) });
}

/**
 * Renombrar y/o guardar la config. Quien tiene campos ocultos no los puede
 * usar, y no reescribe la config de un reporte que los usa: guardaría la
 * versión sin ellos y le borraría columnas o filtros a quien sí los ve.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = reportPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const isHidden = await viewerHiddenKeys(sessionFieldViewer(user));
  if (parsed.data.config) {
    if (configUsesHidden(parsed.data.config, isHidden)) return crmError(400, 'invalid_field');
    const current = await getCustomReport(user.id, id);
    if (!current) return notFound();
    if (configUsesHidden(current.config, isHidden)) return crmError(403, 'report_restricted');
  }
  try {
    const report = await updateCustomReport(user.id, id, parsed.data);
    return report ? NextResponse.json({ ...report, config: redactReportConfig(report.config, isHidden) }) : notFound();
  } catch (e) {
    if (e instanceof ReportError) return crmError(400, e.code);
    throw e;
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return (await deleteCustomReport(user.id, id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
