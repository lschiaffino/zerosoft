import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getForm, listSubmissions } from '@/lib/crm-forms';
import { pageParams } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Envíos de un form, más recientes primero. Respeta la visibilidad por owner de la key. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const form = await getForm(auth.user.id, id);
  if (!form) return apiError(404, 'not_found', 'Form not found.');
  const { page, pageSize } = pageParams(req.nextUrl.searchParams);
  const { rows, total } = await listSubmissions(auth.user.id, id, { page, pageSize, ownerScope: await apiScope(auth) });
  return NextResponse.json({
    submissions: rows.map((r) => ({
      id: r.id,
      formId: r.form_id,
      contactId: r.contact_id,
      contactCreated: !!r.contact_created,
      values: parse(r.data),
      utm: parse(r.utm),
      pageUrl: r.page_url,
      referrer: r.referrer,
      createdAt: r.created_at,
    })),
    total,
    page,
    pageSize,
  });
}
