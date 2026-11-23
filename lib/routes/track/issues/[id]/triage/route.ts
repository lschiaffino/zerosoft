import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, getIssue, getProject } from '@/lib/track-data';
import { resolveTriage } from '@/lib/track-bulk';
import { triageActionSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';
import { createIssueComment } from '@/lib/track-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aceptar (con status), rechazar o marcar como duplicado un issue en triage. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const issue = await getIssue(id);
  const project = issue ? await getProject(issue.project_id) : undefined;
  if (!issue || !project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return notFound();
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = triageActionSchema.safeParse(raw);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await resolveTriage(issue, parsed.data, realUserId(user));
  if (!res.ok) return trackError(res.reason === 'not_in_triage' ? 409 : 400, res.reason);
  // Como Linear: aceptar o rechazar con un comentario opcional. El duplicado ya pasó suscriptos y
  // pedidos de clientes al original (lib/track-duplicates).
  const comment = typeof raw?.comment === 'string' ? raw.comment.trim().slice(0, 5000) : '';
  if (comment) await createIssueComment(issue.id, realUserId(user), { body: comment }).catch(() => undefined);
  return NextResponse.json(res.issue);
}
