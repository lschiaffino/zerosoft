import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getManageableVideo } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { blobUploadEnabled, issueBlobToken } from '@/lib/rec-upload';
import { isRecAudioType, isRecVideoType } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ kind: z.enum(['video', 'audio']), contentType: z.string().max(80) });

/** Token de cliente de Vercel Blob para subir por partes un archivo de este video (path exacto, 6 h). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  if (!blobUploadEnabled()) return recJson({ error: 'storage_unavailable' }, 503);
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  const { kind, contentType } = parsed.data;
  if (kind === 'video' ? !isRecVideoType(contentType) : !isRecAudioType(contentType)) return recJson({ error: 'invalid_type' }, 415);
  try {
    const v = await getManageableVideo(s.actor, id);
    if (v.status !== 'recording') return recJson({ error: 'already_uploaded' }, 409);
    return recJson(await issueBlobToken(v.workspace_id, v.id, kind, contentType));
  } catch (err) {
    return recFail(err);
  }
}
