import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';
import { getHelpWorkspace } from '@/lib/docs-help';
import { canCreateDocPage } from '@/lib/docs-guard';
import { docsError, invalidBody, unauthorized } from '@/lib/docs-http';
import { duplicableSource, duplicatePublished } from '@/lib/docs-public-duplicate';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  handle: z.string().trim().min(1).max(64),
  slug: z.string().trim().min(1).max(200),
  teamspace_id: z.string().min(1).max(64).nullable().optional(),
});

/** Duplica una página publicada (con "Permitir duplicar") al workspace de quien pide. */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'help-duplicate', 20, 600);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const ws = await getHelpWorkspace(parsed.data.handle);
  const source = ws ? await duplicableSource(ws.id, parsed.data.slug) : null;
  if (!source) return docsError(404, 'not_found');
  const teamspaceId = parsed.data.teamspace_id ?? null;
  if (!(await canCreateDocPage(user, { teamspace_id: teamspaceId }))) return docsError(403, 'forbidden');
  const res = await duplicatePublished(source, user.id, teamspaceId);
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'page.duplicated',
    page: { id: res.id, title: source.row.title },
    detail: `from ${parsed.data.handle}/${parsed.data.slug} (${res.pages})`,
    ip: requestIp(req.headers),
  });
  return NextResponse.json({ id: res.id, pages: res.pages }, { status: 201 });
}
