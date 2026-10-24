import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { hasScope } from '@/lib/api-scopes';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La extensión prueba el token: quién es la persona del token y en qué workspace. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const person = (await getDb().prepare('SELECT email, name FROM users WHERE id = ?').get(auth.personId)) as
    | { email: string; name: string | null }
    | undefined;
  return NextResponse.json({
    email: person?.email ?? '',
    name: person?.name ?? '',
    workspace: auth.user.name || auth.user.email,
    canWrite: hasScope(auth.scopes, 'crm:write'),
  });
}
