import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listForms } from '@/lib/crm-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Formularios del workspace (sin user_id). */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const forms = await listForms(auth.user.id);
  return NextResponse.json({
    forms: forms.map(({ user_id: _u, ...f }) => ({ ...f, key: f.slug ?? f.token })),
  });
}
