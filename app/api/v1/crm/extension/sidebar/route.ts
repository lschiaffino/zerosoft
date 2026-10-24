import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { apiScope } from '@/lib/crm-visibility';
import { extensionSidebar, normalizeEmail } from '@/lib/crm-extension';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Panel de la extensión de Gmail: contacto del remitente con empresa, deals y tareas abiertas. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const email = normalizeEmail(req.nextUrl.searchParams.get('email'));
  if (!email) return apiError(400, 'invalid_email', 'Pass ?email= with a valid address.');
  const result = await extensionSidebar(
    { workspaceId: auth.user.id, personId: auth.personId, scope: await apiScope(auth) },
    email,
  );
  return NextResponse.json(result);
}
