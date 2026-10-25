import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, getAccessibleIssue, getProject } from '@/lib/track-data';
import {
  issueSignature,
  leavePresence,
  listPresence,
  projectSignature,
  touchPresence,
  workspaceSignature,
} from '@/lib/track-ux';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const liveSchema = z.object({
  projectId: z.string().min(1).max(80).optional(),
  issueId: z.string().min(1).max(80).optional(),
  /** Issues de todo el workspace (Issues, My tasks). */
  workspace: z.boolean().optional(),
  /** Presencia en el issue: true mientras está abierto, false al salir. */
  present: z.boolean().optional(),
});

/**
 * Sondeo de cambios (sin websockets): devuelve una firma que cambia cuando
 * alguien crea, edita o borra algo. Con `issueId` además registra y devuelve
 * quién más tiene el issue abierto.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = liveSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { projectId, issueId, workspace, present } = parsed.data;
  const teamId = user.team?.id ?? null;

  if (issueId) {
    const found = await getAccessibleIssue(issueId, teamId, user.id);
    if (!found) return notFound();
    const me = realUserId(user);
    if (present === false) {
      await leavePresence(issueId, me);
      return NextResponse.json({ ok: true });
    }
    if (present) await touchPresence(issueId, me);
    const [sig, viewers] = await Promise.all([issueSignature(issueId), listPresence(issueId, me)]);
    return NextResponse.json({ sig, viewers });
  }
  if (projectId) {
    const project = await getProject(projectId);
    if (!project || !canAccessTrackProject(project, teamId, user.id)) return notFound();
    return NextResponse.json({ sig: await projectSignature(projectId) });
  }
  if (workspace) return NextResponse.json({ sig: await workspaceSignature(teamId, user.id) });
  return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
}
