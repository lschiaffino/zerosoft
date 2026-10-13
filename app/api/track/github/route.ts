import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { deleteGithubConfig, getGithubConfig, saveGithubConfig } from '@/lib/track-github';
import { githubConfigSchema } from '@/lib/track-schema';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const config = await getGithubConfig(trackWorkspaceId(user.team?.id ?? null, user.id));
  return NextResponse.json({ config });
}

/** Conectar o editar. El secreto en texto plano vuelve solo si se generó uno nuevo. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const parsed = githubConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const repoIssue = parsed.error.issues.find((i) => i.path[0] === 'repos');
    return trackError(400, repoIssue ? 'invalid_repo' : 'invalid_input');
  }
  const res = await saveGithubConfig(trackWorkspaceId(user.team?.id ?? null, user.id), user.id, parsed.data);
  return NextResponse.json(res);
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  await deleteGithubConfig(trackWorkspaceId(user.team?.id ?? null, user.id));
  return NextResponse.json({ ok: true });
}
