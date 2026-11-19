import { NextRequest, NextResponse } from 'next/server';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { can } from '@/lib/permissions';
import { isFeaturableApp } from '@/lib/featured-apps';
import { loadWorkspaceFeaturedApps, setWorkspaceFeaturedApp } from '@/lib/workspace-apps';
import { rateLimit } from '@/lib/rate-limit';
import { noStore } from '@/lib/no-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: apps destacadas del workspace (las ve cualquiera de la cuenta: arman su menú de apps). */
export async function GET() {
  const ctx = await teamsCtx('member');
  if (isResponse(ctx)) return ctx;
  return noStore(NextResponse.json({ featured: await loadWorkspaceFeaturedApps(ctx.team.owner_id) }));
}

/**
 * PUT { app, featured }: destaca una app para todo el workspace o le saca la
 * marca. Solo owner y admins, como prender y apagar apps. No cambia quién
 * abre la app: solo dónde aparece en el menú.
 */
export async function PUT(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  if (!can({ role: ctx.role }, 'workspace.edit')) return teamsError('forbidden', 403);
  const limit = await rateLimit(`teams:apps:featured:${ctx.realId}`, 240, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const app = typeof body?.app === 'string' ? body.app : '';
  if (!isFeaturableApp(app)) return teamsError('invalid_app');
  if (typeof body?.featured !== 'boolean') return teamsError('invalid_featured');
  const featured = await setWorkspaceFeaturedApp(ctx.team.owner_id, app, body.featured, ctx.realId);
  return noStore(NextResponse.json({ app, featured }));
}
