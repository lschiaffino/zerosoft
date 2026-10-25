import { NextRequest } from 'next/server';
import { getManageableVideo, setAssetMeta, setVideoFile } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { saveRecAsset } from '@/lib/rec-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = { thumb: 2 * 1024 * 1024, gif: 3 * 1024 * 1024 };

/** Miniatura (JPEG, PNG o WebP) o GIF de vista previa, armados en el navegador. ?kind=thumb|gif, multipart `file`. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const kind = req.nextUrl.searchParams.get('kind') === 'gif' ? 'gif' : 'thumb';
  try {
    const v = await getManageableVideo(s.actor, id);
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return recJson({ error: 'invalid_file' }, 400);
    const type = file.type.toLowerCase();
    const ok = kind === 'gif' ? type === 'image/gif' : type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
    if (!ok) return recJson({ error: 'invalid_type' }, 415);
    if (file.size > MAX[kind]) return recJson({ error: 'file_too_large' }, 413);
    const url = await saveRecAsset(v.workspace_id, v.id, kind, type, Buffer.from(await file.arrayBuffer()));
    await setVideoFile(v.id, kind, url);
    // Para qué recorte se armó y de qué segundo sale la miniatura (si no se sabe, solo la ve quien administra).
    const forTrim = req.nextUrl.searchParams.get('for');
    const at = Number(req.nextUrl.searchParams.get('at'));
    await setAssetMeta(v.id, kind, forTrim && /^\d+(\.\d)?:(\d+(\.\d)?)?$/.test(forTrim) ? forTrim : null, Number.isFinite(at) && req.nextUrl.searchParams.has('at') ? at : null);
    return recJson({ ok: true });
  } catch (err) {
    return recFail(err);
  }
}
