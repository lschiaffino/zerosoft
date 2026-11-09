import { NextRequest, NextResponse } from 'next/server';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { can } from '@/lib/permissions';
import { isRuleKey, parseRule } from '@/lib/app-access';
import { loadWorkspaceAppRules, saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { listGroups } from '@/lib/workspace-groups';
import { listTeamPeople } from '@/lib/workspace';
import { audit } from '@/lib/workspace-admin';
import { rateLimit } from '@/lib/rate-limit';
import { noStore } from '@/lib/no-store';
import { PRODUCT_CONFIG } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: reglas de Apps del workspace (owner y admins). */
export async function GET() {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  return noStore(NextResponse.json({ rules: await loadWorkspaceAppRules(ctx.team.owner_id) }));
}

/**
 * PUT { app, mode, people?, teams?, denied? }: para quién está una app en el
 * workspace. 'all' (todos), 'some' (personas y equipos elegidos; owner y admins
 * siempre), 'admins' u 'off' (nadie; los datos quedan). `denied` deja a una
 * persona afuera en cualquier modo (owner y admins no). Solo restringe: las
 * apps habilitadas de cada persona siguen valiendo.
 */
export async function PUT(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  if (!can({ role: ctx.role }, 'workspace.edit')) return teamsError('forbidden', 403);
  const limit = await rateLimit(`teams:apps:${ctx.realId}`, 120, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const app = typeof body?.app === 'string' ? body.app : '';
  if (!isRuleKey(app)) return teamsError('invalid_app');
  const rule = parseRule(body);
  if (!rule) return teamsError('invalid_mode');
  // Solo personas y equipos de este workspace.
  if (rule.mode === 'some' || rule.denied.length) {
    const [people, groups] = await Promise.all([listTeamPeople(ctx.team), listGroups(ctx.team.owner_id)]);
    const personIds = new Set(people.map((p) => p.user_id));
    const groupIds = new Set(groups.map((g) => g.id));
    rule.people = rule.people.filter((id) => personIds.has(id));
    rule.teams = rule.teams.filter((id) => groupIds.has(id));
    rule.denied = rule.denied.filter((id) => personIds.has(id));
  }
  const before = await saveWorkspaceAppRule(ctx.team.owner_id, app, rule, ctx.realId);
  if (before.mode !== rule.mode || before.people.join() !== rule.people.join() || before.teams.join() !== rule.teams.join() || before.denied.join() !== rule.denied.join()) {
    await audit({
      teamId: ctx.team.id,
      actorId: ctx.realId,
      targetId: null,
      targetLabel: PRODUCT_CONFIG[app].name,
      action: 'workspace.app',
      before: { app, ...before },
      after: { app, ...rule },
    });
  }
  return noStore(NextResponse.json({ app, rule, rules: await loadWorkspaceAppRules(ctx.team.owner_id) }));
}
