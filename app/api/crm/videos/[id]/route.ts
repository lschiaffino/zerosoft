import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteVideo, getVideo, listVideoViews, updateVideo } from '@/lib/crm-media';
import { canManage, json, mediaFail, mediaUser } from '@/lib/crm-media-http';
import { crmError, notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const video = await getVideo(u.user.id, id);
  if (!video) return notFound();
  return json({ video, views: await listVideoViews(u.user.id, id) });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  message: z.string().max(2000).optional(),
  contactId: z.string().max(64).nullish(),
});

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const video = await getVideo(u.user.id, id);
  if (!video) return notFound();
  if (!canManage(u, video.created_by)) return crmError(403, 'forbidden');
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  try {
    return json(await updateVideo(u.user.id, id, parsed.data));
  } catch (err) {
    return mediaFail(err);
  }
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const video = await getVideo(u.user.id, id);
  if (!video) return notFound();
  if (!canManage(u, video.created_by)) return crmError(403, 'forbidden');
  await deleteVideo(u.user.id, id);
  return new NextResponse(null, { status: 204 });
}
