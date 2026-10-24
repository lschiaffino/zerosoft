import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createVideo, listVideos } from '@/lib/crm-media';
import { json, mediaFail, mediaUser, storeMultipart } from '@/lib/crm-media-http';
import { isAllowedVideoType } from '@/lib/crm-media-schema';
import { crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await mediaUser();
  if ('res' in u) return u.res;
  return json({ rows: await listVideos(u.user.id, req.nextUrl.searchParams.get('q') ?? '') });
}

const registerSchema = z.object({
  title: z.string().trim().max(200).default(''),
  url: z.string().trim().min(1).max(2000),
  contentType: z.string().trim().max(80),
  size: z.number().int().min(0),
  durationSec: z.number().min(0).max(6 * 3600).optional(),
  contactId: z.string().max(64).nullish(),
  message: z.string().max(2000).optional(),
});

/** Sube un video (multipart `file` + title/contactId/message/durationSec) o registra uno ya subido a Blob. */
export async function POST(req: NextRequest) {
  const u = await mediaUser();
  if ('res' in u) return u.res;
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const stored = await storeMultipart(await req.formData().catch(() => null), 'video');
      const f = stored.fields;
      const video = await createVideo(u.user.id, {
        title: f.title ?? '',
        url: stored.url,
        contentType: stored.contentType,
        size: stored.size,
        durationSec: Number(f.durationSec) || 0,
        contactId: f.contactId || null,
        message: f.message ?? '',
        createdBy: u.actor,
      });
      return json(video, 201);
    }
    const parsed = registerSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !isAllowedVideoType(parsed.data.contentType)) return crmError(400, 'invalid_input');
    return json(await createVideo(u.user.id, { ...parsed.data, createdBy: u.actor }), 201);
  } catch (err) {
    return mediaFail(err);
  }
}
