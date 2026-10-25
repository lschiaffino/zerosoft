import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { deleteGithubRules, listGithubRules, saveGithubRules } from '@/lib/track-github';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { recordAudit } from '@/lib/track-audit';
import { githubAppConfigured } from '@/lib/track-github-app';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reglas por proyecto (status por momento del PR y repo de GitHub Issues). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({
    rows: await listGithubRules(trackWorkspaceId(user.team?.id ?? null, user.id)),
    appAvailable: githubAppConfigured(),
  });
}

const statusRef = z.string().trim().min(1).max(64).nullable();
const schema = z.object({
  projectId: z.string().trim().min(1).max(64),
  /** null en las cuatro y sin repo = volver a las reglas del workspace. */
  reset: z.boolean().optional(),
  onDraft: statusRef.default(null),
  onOpen: statusRef.default(null),
  onReview: statusRef.default(null),
  onMerge: statusRef.default(null),
  syncRepo: z
    .string()
    .trim()
    .max(200)
    .regex(/^$|^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'invalid_repo')
    .nullable()
    .default(null),
});

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return trackError(400, parsed.error.issues.some((i) => i.message === 'invalid_repo') ? 'invalid_repo' : 'invalid_input');
  const project = await getProject(parsed.data.projectId);
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return trackError(404, 'not_found');
  if (parsed.data.reset) {
    await deleteGithubRules(project.id);
  } else {
    const res = await saveGithubRules(project.id, { ...parsed.data, syncRepo: parsed.data.syncRepo || null });
    if (res !== 'ok') return trackError(400, res);
  }
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  await recordAudit({
    workspaceId: ws,
    actorId: realUserId(user),
    action: 'integration.updated',
    entityType: 'integration',
    entityLabel: `GitHub · ${project.name}`,
    projectId: project.id,
    data: parsed.data.reset ? { reset: true } : { syncRepo: parsed.data.syncRepo || null },
  });
  return NextResponse.json({ rows: await listGithubRules(ws) });
}
