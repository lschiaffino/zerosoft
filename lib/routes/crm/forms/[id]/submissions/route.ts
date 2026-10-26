import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getForm, listSubmissions, submissionsCsv } from '@/lib/crm-forms';
import { notFound, pageParams, unauthorized } from '@/lib/crm-http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Envíos de un form (JSON paginado o ?format=csv con todos). Respeta la visibilidad por owner. */
export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const form = await getForm(user.id, id);
  if (!form) return notFound();
  const scope = await sessionScope(user);
  const sp = req.nextUrl.searchParams;
  if (sp.get('format') === 'csv') {
    const { rows } = await listSubmissions(user.id, id, { pageSize: 5000, ownerScope: scope });
    const date = new Date().toISOString().slice(0, 10);
    const name = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'form';
    return new NextResponse(submissionsCsv(form, rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}-submissions-${date}.csv"`,
      },
    });
  }
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listSubmissions(user.id, id, { page, pageSize, ownerScope: scope });
  return NextResponse.json({ rows, total, page, pageSize });
}
