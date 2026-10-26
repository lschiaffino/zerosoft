import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getAccessibleIssue, listIssueComments } from '@/lib/track-data';
import { deleteExternalRef, listIssueRefs, refView } from '@/lib/track-integrations';
import { descriptionToText } from '@/lib/track-api';
import { figmaEmbedUrl, linkSupportUrls, parseSupportUrl } from '@/lib/track-support';
import { projectWorkspaceId } from '@/lib/track-labels';
import { recordAudit } from '@/lib/track-audit';
import { notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

const URL_RE = /https:\/\/[^\s)<>\]"']+/g;

/** Links de Figma en la descripción y los comentarios (se muestran como embed). */
function figmaLinks(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const m of t.match(URL_RE) ?? []) {
      const parsed = parseSupportUrl(m);
      if (parsed?.provider === 'figma' && !out.includes(parsed.url)) out.push(parsed.url);
    }
  }
  return out.slice(0, 5);
}

/** Vínculos externos del issue (hilo de Slack, Sentry, GitHub Issues, Zendesk, Intercom, Figma). */
export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const refs = (await listIssueRefs(found.issue.id)).map(refView);
  const comments = await listIssueComments(found.issue.id);
  const inText = figmaLinks([descriptionToText(found.issue.description), ...comments.map((c) => c.body)]);
  const linkedFigma = refs.filter((r) => r.provider === 'figma').map((r) => r.url ?? '');
  const figma = [...new Set([...linkedFigma, ...inText])].filter(Boolean).map((url) => ({ url, embedUrl: figmaEmbedUrl(url) }));
  return NextResponse.json({ refs: refs.filter((r) => r.provider !== 'figma'), figma });
}

const schema = z.object({ url: z.string().trim().url().max(2000) });

/** Vincula un link de Sentry, Zendesk, Intercom o Figma. */
export async function POST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parseSupportUrl(parsed.data.url)) return trackError(400, 'unsupported_link');
  const ws = projectWorkspaceId(found.project);
  if (!ws) return notFound();
  await linkSupportUrls(found.issue.id, ws, [parsed.data.url]);
  await recordAudit({
    workspaceId: ws,
    actorId: realUserId(user),
    action: 'issue.updated',
    entityType: 'issue',
    entityId: found.issue.id,
    entityLabel: `${found.issue.identifier} ${found.issue.title}`,
    projectId: found.project.id,
    data: { linked: parsed.data.url },
  });
  return GET(req, props);
}

export async function DELETE(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const refId = new URL(req.url).searchParams.get('refId') ?? '';
  if (!(await deleteExternalRef(found.issue.id, refId))) return notFound();
  return GET(req, props);
}
