import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { createLink, linkShortUrl } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { userCanUseApp } from '@/lib/session';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  url: z.string().trim().min(4).max(2000),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
});

/**
 * Acorta un link con Link (/s/…) y le suma los UTM. Pide la app Link: sin
 * ella la persona no puede crear links en el workspace.
 */
export async function POST(req: NextRequest) {
  return withSocial(
    async ({ user, actor }) => {
      if (!userCanUseApp(user, 'link')) return jsonError(403, 'link_app_required');
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      const res = await createLink(actor.workspaceId, {
        url: body.url,
        utmSource: body.utmSource,
        utmMedium: body.utmMedium,
        utmCampaign: body.utmCampaign,
        createdBy: actor.personId,
        viewer: viewerOf(user),
        via: 'app',
      } as Parameters<typeof createLink>[1]);
      if (!res.ok) return jsonError(400, res.code);
      return NextResponse.json({ shortUrl: linkShortUrl({ slug: res.link.slug, domain_hostname: null }), linkId: res.link.id, url: res.link.url }, { status: 201 });
    },
    { write: 'shorten', limit: 60 },
  );
}
