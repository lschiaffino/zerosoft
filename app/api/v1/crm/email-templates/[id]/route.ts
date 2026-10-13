import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getEmailTemplate } from '@/lib/crm-email';
import { cleanRow } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const template = await getEmailTemplate(auth.user.id, id);
  if (!template) return apiError(404, 'not_found', 'Template not found.');
  return NextResponse.json(cleanRow(template));
}
