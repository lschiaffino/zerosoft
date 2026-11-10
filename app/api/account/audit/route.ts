import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getUserById } from '@/lib/db';
import {
  listWorkspaceSecurityEvents,
  membersWithoutMfa,
  mfaEnabled,
  recordSecurityEvent,
  securityEventsCsv,
  setWorkspaceRequireMfa,
} from '@/lib/account-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Registro de seguridad del workspace activo (owner y admins): eventos con `before` como
 * cursor, o todo el último año en CSV con `?format=csv`.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.workspace || !isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  if (url.searchParams.get('format') === 'csv') {
    const rows = await listWorkspaceSecurityEvents(user.workspace.id, { limit: 5000 });
    await recordSecurityEvent({ userId: realUserId(user), teamId: user.workspace.id, action: 'export.workspace', target: 'audit_log', meta: { rows: rows.length } });
    return new NextResponse(securityEventsCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="zerosoft-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }
  const before = url.searchParams.get('before');
  const events = await listWorkspaceSecurityEvents(user.workspace.id, { limit: 50, before: before && before.length <= 40 ? before : null });
  return NextResponse.json({
    events,
    requireMfa: Boolean(user.workspace.require_mfa),
    withoutMfa: await membersWithoutMfa(user.workspace.id),
  });
}

const patchSchema = z.object({ requireMfa: z.boolean(), workspaceId: z.string().max(128).optional() });

/** Exigir (o no) la verificación en dos pasos a cada miembro del workspace. Solo el owner. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.workspace || user.role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (parsed.data.workspaceId && parsed.data.workspaceId !== user.workspace.id) return NextResponse.json({ error: 'wrong_workspace' }, { status: 409 });
  const me = await getUserById(realUserId(user));
  // Primero quien la exige: así nunca queda afuera de su propio workspace.
  if (parsed.data.requireMfa && (!me || !mfaEnabled(me))) return NextResponse.json({ error: 'enable_mfa_first' }, { status: 409 });
  await setWorkspaceRequireMfa(user.workspace.id, parsed.data.requireMfa);
  await recordSecurityEvent({ userId: realUserId(user), teamId: user.workspace.id, action: 'workspace.require_mfa', meta: { on: parsed.data.requireMfa } });
  return NextResponse.json({ ok: true });
}
