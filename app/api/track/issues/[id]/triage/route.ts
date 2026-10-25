import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, getIssue, getProject } from '@/lib/track-data';
import { resolveTriage } from '@/lib/track-bulk';
import { triageActionSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';
import { createIssueComment } from '@/lib/track-data';
import { moveRequests } from '@/lib/track-customers';

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
  // Como Linear: aceptar o rechazar con un comentario opcional; el duplicado pasa sus pedidos de clientes al original.
  const comment = typeof raw?.comment === 'string' ? raw.comment.trim().slice(0, 5000) : '';
  if (comment) await createIssueComment(issue.id, realUserId(user), { body: comment }).catch(() => undefined);
  if (parsed.data.action === 'duplicate') {
    const rel = (await import('@/lib/track-data')).listIssueRelations;
    const original = (await rel(issue.id)).find((r) => r.type === 'duplicates' && r.issue_id === issue.id);
    if (original) await moveRequests(issue.id, original.related_issue_id);
  }
  return NextResponse.json(res.issue);
}
