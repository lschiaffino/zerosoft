import { NextRequest, NextResponse } from 'next/server';
import { getPublicVideo } from '@/lib/crm-media';
import { serveVideo } from '@/lib/crm-media-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Archivo del video de un link /watch: sin login, con rangos para poder adelantar. */
export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const video = await getPublicVideo(token);
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return serveVideo(req, video.url, video.contentType);
}
