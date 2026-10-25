import { NextRequest } from 'next/server';
import { getVideo } from '@/lib/crm-media';
import { mediaUser } from '@/lib/crm-media-http';
import { serveVideo } from '@/lib/crm-media-file';
import { notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Archivo del video para la vista previa dentro del CRM. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const video = await getVideo(u.user.id, id);
  if (!video) return notFound();
  return serveVideo(req, video.url, video.content_type);
}
