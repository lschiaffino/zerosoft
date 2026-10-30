import { NextRequest } from 'next/server';
import { z } from 'zod';
import { userCanUseApp } from '@/lib/workspace';
import { createLink, toLinkDto } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { ensureSettings, requireManage } from '@/lib/hiring/core';
import { jobUrl } from '@/lib/hiring/careers';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  utmSource: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
});

/** POST: link corto de Link (con UTM) al aviso del puesto. Necesita también la app Link. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  if (!userCanUseApp(a.user, 'link')) return hJson({ error: 'link_unavailable' }, 403);
  try {
    const input = await parseBody(req, schema);
    const job = await requireManage(a.actor, (await params).id);
    const settings = await ensureSettings(a.actor.ws);
    const res = await createLink(a.actor.ws, {
      url: jobUrl(settings.handle, job.slug),
      title: job.title,
      utmSource: input.utmSource || undefined,
      utmMedium: input.utmMedium || undefined,
      utmCampaign: input.utmCampaign || undefined,
      createdBy: a.actor.person,
      viewer: viewerOf(a.user),
    } as Parameters<typeof createLink>[1]);
    if (!res.ok) return hJson({ error: res.code }, 400);
    const dto = toLinkDto(res.link);
    return hJson({ link: { id: dto.id, shortUrl: dto.short_url, url: dto.url } }, 201);
  } catch (err) {
    return hFail(err);
  }
}
