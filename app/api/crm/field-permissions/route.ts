import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { listFieldPermissions } from '@/lib/crm-field-perms';
import { forbidden, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reglas de permisos por campo del workspace (solo owner/admin). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  return NextResponse.json({ rows: await listFieldPermissions(user.id) });
}
