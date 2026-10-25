import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getDocsSettings, updateDocsSettings } from '@/lib/docs-access';
import { forbidden, invalidBody, unauthorized } from '@/lib/docs-http';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  member_role: z.enum(['view', 'comment', 'edit', 'full']).optional(),
  allow_export: z.boolean().optional(),
  allow_publish: z.boolean().optional(),
  allow_guests: z.boolean().optional(),
});

/** Ajustes de Docs del workspace activo (cualquiera los lee; los cambia un admin). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ ...(await getDocsSettings(user.id)), can_manage: isWorkspaceAdmin(user) });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const before = await getDocsSettings(user.id);
  const next = await updateDocsSettings(user.id, parsed.data);
  const changed = (Object.keys(parsed.data) as Array<keyof typeof parsed.data>)
    .filter((k) => before[k] !== next[k])
    .map((k) => `${k}=${String(next[k])}`);
  if (changed.length) {
    await logDocsAudit({ workspaceId: user.id, actor: user.actingUser ?? user, action: 'settings.updated', detail: changed.join(', '), ip: requestIp(req.headers) });
  }
  return NextResponse.json({ ...next, can_manage: true });
}
