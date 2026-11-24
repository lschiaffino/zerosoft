import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import { withIdempotency } from '@/lib/offline-idempotency';
import { getCurrentUser, realUserId } from '@/lib/session';
import { submitFormTemplate } from '@/lib/track-form-submit';
import { trackEventAudience } from '@/lib/track-access';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { getTemplate } from '@/lib/track-templates';
import { templateSubmitSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Responder un formulario de pedidos: crea el issue en el team de la
 * plantilla (en triage si el team lo tiene). Solo quien puede ver el team.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const template = await getTemplate(id);
  const project = template ? await getProject(template.project_id) : undefined;
  if (!template || !project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return notFound();

  return withIdempotency(req, realUserId(user), async () => {
    const parsed = templateSubmitSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalidBody(parsed.error);
    const res = await submitFormTemplate({ template, project, creatorId: realUserId(user), ownerId: user.id, payload: parsed.data });
    if (!res.ok) return NextResponse.json({ error: res.error, fields: res.fields }, { status: 400 });
    const issue = res.issue;
    after(() =>
      emitEvent(user.id, 'issue.created', {
        issue: { id: issue.id, identifier: issue.identifier, title: issue.title, priority: issue.priority, status: issue.status_name ?? null, assigneeId: issue.assignee_id },
        project: { id: project.id, name: project.name },
      }, { audience: trackEventAudience(project) }),
    );
    return NextResponse.json({ id: issue.id, identifier: issue.identifier, triage: issue.triage === 1 }, { status: 201 });
  });
}
