import { NextRequest } from 'next/server';
import { getManageableVideo } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { blobUploadEnabled, saveLocalPart } from '@/lib/rec-upload';
import { LOCAL_PART_BYTES } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLACK = 64 * 1024;

/**
 * Una parte del video o del audio mientras se graba (sin Blob: dev y
 * self-host). PUT ?kind=video|audio&n=<1..>, cuerpo binario de hasta 3 MB.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  if (blobUploadEnabled()) return recJson({ error: 'use_blob' }, 409);
  const { id } = await ctx.params;
  const kind = req.nextUrl.searchParams.get('kind') === 'audio' ? 'audio' : 'video';
  const n = Number(req.nextUrl.searchParams.get('n'));
  if (Number(req.headers.get('content-length') ?? 0) > LOCAL_PART_BYTES + SLACK) return recJson({ error: 'part_too_large' }, 413);
  try {
    const v = await getManageableVideo(s.actor, id);
    if (v.status !== 'recording') return recJson({ error: 'already_uploaded' }, 409);
    const body = Buffer.from(await req.arrayBuffer());
    if (body.length > LOCAL_PART_BYTES + SLACK) return recJson({ error: 'part_too_large' }, 413);
    await saveLocalPart(v.id, kind, n, body);
    return new Response(null, { status: 204 });
  } catch (err) {
    return recFail(err);
  }
}
