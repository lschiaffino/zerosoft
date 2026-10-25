import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getMeeting, markActionsSent, type MeetingAction } from '@/lib/docs-meetings';
import { meetingFor } from '@/lib/docs-meetings-http';
import { docsError, invalidBody } from '@/lib/docs-http';
import { realUserId } from '@/lib/session';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  target: z.enum(['track', 'crm']),
  /** Track: proyecto donde se crean los issues. */
  projectId: z.string().max(100).optional(),
  /** Índices de las tareas a mandar (vacío: todas las que no se mandaron). */
  indexes: z.array(z.number().int().min(0).max(100)).max(40).optional(),
});

/**
 * Manda las tareas de la reunión a Track (un issue por tarea, en un proyecto
 * que la persona puede ver) o al CRM (tareas). Cada tarea mandada guarda el
 * vínculo y no se vuelve a mandar.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await meetingFor(id, true);
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitWrites('docs:meeting-tasks', realUserId(ctx.user), 10);
  if (limited) return limited;
  const m = await getMeeting(id);
  if (!m) return docsError(404, 'not_found');
  const wanted = (parsed.data.indexes?.length ? parsed.data.indexes : m.actions.map((_, i) => i)).filter((i) => m.actions[i] && !m.actions[i].sent);
  if (!wanted.length) return docsError(400, 'nothing_to_send');
  const ws = ctx.meeting.workspace_id;
  const person = realUserId(ctx.user);
  const pageUrl = `/app/docs/${m.pageId}`;
  const body = (a: MeetingAction) =>
    [a.owner ? `Owner: ${a.owner}` : '', a.due ? `Due: ${a.due}` : '', `From the meeting notes "${m.title || 'Meeting'}": ${pageUrl}`].filter(Boolean).join('\n');
  const sent: Array<{ index: number; ref: NonNullable<MeetingAction['sent']> }> = [];
  if (parsed.data.target === 'track') {
    const { listProjectMetas } = await import('@/lib/track-data');
    const projects = await listProjectMetas(ctx.user.team?.id ?? null, ctx.user.id);
    const project = projects.find((p) => p.id === parsed.data.projectId);
    if (!project) return docsError(404, 'project_not_found');
    const { createIssue } = await import('@/lib/track-data');
    for (const i of wanted) {
      const a = m.actions[i];
      const issue = await createIssue(project.id, person, { title: a.text.slice(0, 200), description: [{ type: 'text', text: body(a) }], priority: 'medium' }, { source: 'api' });
      sent.push({ index: i, ref: { kind: 'track', id: issue.id, label: issue.identifier, url: `/app/track/issues/${issue.id}` } });
    }
  } else {
    const { createActivity } = await import('@/lib/crm');
    for (const i of wanted) {
      const a = m.actions[i];
      const due = /^\d{4}-\d{2}-\d{2}/.test(a.due) ? `${a.due.slice(0, 10)} 12:00:00` : null;
      const task = await createActivity(ws, { type: 'task', subject: a.text.slice(0, 300), body: body(a), dueAt: due, ownerId: person });
      sent.push({ index: i, ref: { kind: 'crm', id: task.id, label: task.subject, url: '/app/crm/tasks' } });
    }
  }
  return NextResponse.json({ meeting: await markActionsSent(id, sent), sent: sent.length });
}
