import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { readableMessage, listTalkPeople } from '@/lib/talk';
import { talkPlainText } from '@/lib/talk-markdown';
import { canAccessTrackProject, createIssue, getProject } from '@/lib/track-data';
import { emitEventSoon } from '@/lib/events';
import { siteUrl } from '@/lib/board-urls';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  projectId: z.string().min(1).max(64),
  title: z.string().max(300).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

/** Crea un issue de Track desde el mensaje (título y descripción con el texto y el link al mensaje). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      const found = await readableMessage(actor, id);
      if (!found || found.message.deleted_at) return jsonError(404, 'not_found');
      const project = await getProject(body.projectId);
      if (!project || !canAccessTrackProject(project, actor.teamId, actor.workspaceId)) return jsonError(404, 'project_not_found');
      const people = await listTalkPeople(actor.workspaceId);
      const byId = new Map(people.map((p) => [p.id, p.name]));
      const text = talkPlainText(found.message.body, { user: (u) => byId.get(u) });
      const title = (body.title?.trim() || text.split('\n')[0] || 'Talk message').slice(0, 200);
      const link = `${siteUrl()}/${body.locale ?? 'en'}/app/talk/${found.message.channel_id}?m=${found.message.parent_id ?? found.message.id}${found.message.parent_id ? `&thread=${found.message.parent_id}` : ''}`;
      const author = found.message.bot_name || (found.message.user_id ? byId.get(found.message.user_id) : '') || '';
      const where = found.access.channel.kind === 'public' || found.access.channel.kind === 'private' ? `#${found.access.channel.name}` : 'Talk';
      const description = `${text}\n\n${author ? `${author} · ` : ''}${where}: ${link}`;
      const issue = await createIssue(project.id, actor.personId, { title, description: [{ type: 'text', text: description }], priority: body.priority }, { source: 'app' });
      await emitEventSoon(actor.workspaceId, 'issue.created', { id: issue.id, identifier: issue.identifier, title: issue.title, projectId: project.id });
      return NextResponse.json({ id: issue.id, identifier: issue.identifier, title: issue.title, url: `/app/track/issues/${issue.id}` }, { status: 201 });
    },
    { write: 'issues', limit: 60 },
  );
}
