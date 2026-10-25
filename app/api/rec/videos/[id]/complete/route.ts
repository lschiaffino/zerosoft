import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getManageableVideo, setVideoFile } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { assembleLocal, blobUploadEnabled, isOwnRecUrl } from '@/lib/rec-upload';
import { MAX_REC_PARTS, isRecAudioType, isRecVideoType } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['video', 'audio']),
  contentType: z.string().max(80),
  /** Blob: la URL que devolvió completeMultipartUpload. */
  url: z.string().url().max(1000).optional(),
  size: z.number().min(0).optional(),
  /** Local: cuántas partes se subieron. */
  parts: z.number().int().min(1).max(MAX_REC_PARTS).optional(),
});

/** Cierra la subida de un archivo del video (Blob: valida la URL; local: une las partes). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  const { kind, contentType } = parsed.data;
  if (kind === 'video' ? !isRecVideoType(contentType) : !isRecAudioType(contentType)) return recJson({ error: 'invalid_type' }, 415);
  try {
    const v = await getManageableVideo(s.actor, id);
    if (v.status !== 'recording') return recJson({ error: 'already_uploaded' }, 409);
    let url: string;
    let size = parsed.data.size ?? 0;
    if (blobUploadEnabled()) {
      if (!parsed.data.url || !isOwnRecUrl(parsed.data.url, v.workspace_id, v.id)) return recJson({ error: 'invalid_file' }, 400);
      url = parsed.data.url;
      // El tamaño real (la parte 1 crece unos bytes al escribirle la duración): se sirve por rangos contra este número.
      const { head } = await import('@vercel/blob');
      const meta = await head(url).catch(() => null);
      if (!meta) return recJson({ error: 'upload_incomplete' }, 409);
      size = meta.size;
    } else {
      if (!parsed.data.parts) return recJson({ error: 'invalid_input' }, 400);
      const out = await assembleLocal(v.id, kind, contentType, parsed.data.parts);
      url = out.url;
      size = out.size;
    }
    await setVideoFile(v.id, kind, url, { size, contentType: kind === 'video' ? contentType.split(';')[0] : undefined });
    return recJson({ ok: true });
  } catch (err) {
    return recFail(err);
  }
}
