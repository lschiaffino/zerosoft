import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { formsForViewer, listForms } from '@/lib/crm-forms';
import { apiFieldViewer } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Formularios del workspace (sin user_id). */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  // Sin nombrar propiedades que la persona de la key tiene ocultas.
  const forms = await formsForViewer(apiFieldViewer(auth), await listForms(auth.user.id));
  return NextResponse.json({
    forms: forms.map(({ user_id: _u, ...f }) => ({ ...f, key: f.slug ?? f.token })),
  });
}
