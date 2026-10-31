import { NextRequest } from 'next/server';
import { z } from 'zod';
import { canManage } from '@/lib/rec';
import { exportableVideo, videoDocBlocks, videoIssueText } from '@/lib/rec-admin';
import { actorOf, recActor, recFail, recJson } from '@/lib/rec-http';
import { recShareUrl } from '@/lib/rec-page';
import { userCanUseApp } from '@/lib/workspace';
import { limitByIp } from '@/lib/rate-limit';
import { getTranslations } from 'next-intl/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** A dónde se puede pasar este video: Docs y los proyectos de Track que esta persona ve. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    const actor = actorOf(s.user);
    await exportableVideo(actor, id, (v) => canManage(actor, v));
    const docs = userCanUseApp(s.user, 'docs');
    let projects: Array<{ id: string; name: string }> = [];
    if (userCanUseApp(s.user, 'track')) {
      const { listProjectMetas } = await import('@/lib/track-data');
      const rows = await listProjectMetas(s.user.team?.id ?? null, s.user.id);
      projects = rows.map((p) => ({ id: p.id, name: p.name }));
    }
    return recJson({ docs, projects });
  } catch (err) {
    return recFail(err);
  }
}

const schema = z.object({
  target: z.enum(['doc', 'issue']),
  projectId: z.string().max(64).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

/** Crea una página de Docs o un issue de Track con lo que esta persona puede ver del video. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const limited = await limitByIp(req, 'rec:export', 30, 600);
  if (limited) return limited;
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  const locale = parsed.data.locale ?? 'en';
  try {
    const actor = actorOf(s.user);
    const { v, content } = await exportableVideo(actor, id, (row) => canManage(actor, row));
    const t = await getTranslations({ locale, namespace: 'rec.export' });
    const url = recShareUrl(locale, v.share_id);
    if (parsed.data.target === 'doc') {
      if (!userCanUseApp(s.user, 'docs')) return recJson({ error: 'forbidden' }, 403);
      const { canCreateDocPage } = await import('@/lib/docs-guard');
      if (!(await canCreateDocPage(s.user, {}))) return recJson({ error: 'forbidden' }, 403);
      const { createDocPage } = await import('@/lib/docs');
      const page = await createDocPage(s.user.id, {
        title: v.title,
        content: videoDocBlocks(v, content, url, { watch: t('watch'), summary: t('summary'), chapters: t('chapters'), transcript: t('transcript') }),
      });
      return recJson({ href: `/app/docs/${page.id}` }, 201);
    }
    if (!userCanUseApp(s.user, 'track')) return recJson({ error: 'forbidden' }, 403);
    const { listProjectMetas, createIssue } = await import('@/lib/track-data');
    const projects = await listProjectMetas(s.user.team?.id ?? null, s.user.id);
    const project = projects.find((p) => p.id === parsed.data.projectId);
    if (!project) return recJson({ error: 'invalid_input' }, 400);
    const { textToDescription } = await import('@/lib/track-api');
    const issue = await createIssue(
      project.id,
      actor.actor,
      { title: v.title.slice(0, 200), description: textToDescription(videoIssueText(v, content, url, { watch: t('watch'), summary: t('summary'), transcript: t('transcript') })) } as never,
      { source: 'app' },
    );
    return recJson({ href: `/app/track/issues/${issue.id}` }, 201);
  } catch (err) {
    return recFail(err);
  }
}
