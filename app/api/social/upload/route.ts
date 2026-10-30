import { NextRequest, NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { MAX_UPLOAD_SIZE, mimeForUploadName, saveUpload, UploadError } from '@/lib/uploads';
import { cleanFileName } from '@/lib/docs-files';
import { jsonError } from '@/lib/write-limit';
import type { MediaItem } from '@/lib/social-networks';
import { registerMedia } from '@/lib/social';
import { sniffMediaType } from '@/lib/social-media-sniff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const VIDEO = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/**
 * Sube una foto o un video para una publicación (form: file, width, height,
 * duration). Las medidas y la duración las mide el navegador; se usan para
 * validar contra cada red antes de programar. Va a la carpeta pública
 * "social": las redes bajan el archivo por URL al publicar.
 */
export async function POST(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof Blob) || file.size === 0) return jsonError(400, 'invalid_input');
      if (file.size > MAX_UPLOAD_SIZE) return jsonError(413, 'file_too_large');
      const name = cleanFileName((file as File).name) || 'media';
      // El tipo sale de la extensión permitida (no del que dice el navegador).
      const mime = mimeForUploadName(name);
      const type = IMAGE.has(mime) ? 'image' : VIDEO.has(mime) ? 'video' : null;
      if (!type) return jsonError(415, 'file_type_not_allowed');
      const bytes = Buffer.from(await file.arrayBuffer());
      // El contenido tiene que ser lo que dice la extensión (un .jpg que en realidad es otra cosa no entra).
      const sniffed = sniffMediaType(bytes);
      const isoVideo = (t: string | null) => t === 'video/mp4' || t === 'video/quicktime';
      if (sniffed !== mime && !(isoVideo(sniffed) && isoVideo(mime))) return jsonError(415, 'file_type_not_allowed');
      let url: string;
      try {
        url = await saveUpload('social', name, mime, bytes);
      } catch (err) {
        if (err instanceof UploadError) return jsonError(err.status, err.code);
        throw err;
      }
      const num = (k: string) => {
        const v = Number(form?.get(k));
        return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
      };
      const item: MediaItem = { url, type, mime, size: file.size, name, width: num('width'), height: num('height'), duration: type === 'video' ? num('duration') : null };
      await registerMedia(actor, item);
      return NextResponse.json(item, { status: 201 });
    },
    { write: 'upload', limit: 60 },
  );
}
