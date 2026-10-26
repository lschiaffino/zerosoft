import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteCustomReport, getCustomReport, ReportError, updateCustomReport } from '@/lib/crm-custom-reports';
import { reportPatchSchema } from '@/lib/crm-report-builder';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const report = await getCustomReport(user.id, id);
  return report ? NextResponse.json(report) : notFound();
}

/** Renombrar y/o guardar la config. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = reportPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const report = await updateCustomReport(user.id, id, parsed.data);
    return report ? NextResponse.json(report) : notFound();
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
