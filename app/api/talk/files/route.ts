import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { addFile, listFiles } from '@/lib/talk-extras';
import { MAX_UPLOAD_SIZE, saveUpload, UploadError } from '@/lib/uploads';
import { cleanFileName } from '@/lib/docs-files';
import { writableChannel } from '@/lib/talk';

/** Explorador de archivos: ?channel=&q=&kind=image|document. */
export async function GET(req: NextRequest) {
  return withTalk(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const kind = sp.get('kind');
    return NextResponse.json({
      files: await listFiles(actor, { channelId: sp.get('channel'), q: sp.get('q')?.slice(0, 100), kind: kind === 'image' || kind === 'document' ? kind : 'all' }),
    });
  });
}

/**
 * Sube un archivo para mandarlo en un mensaje (form: file, channelId). Se
 * guarda en el storage privado (mismas reglas que Docs: 10 MB, sin HTML ni
 * SVG ni scripts) y se sirve por /api/talk/files/<id>, que chequea acceso.
 */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      const channelId = String(form?.get('channelId') ?? '');
      if (!(file instanceof Blob) || file.size === 0 || !channelId) return jsonError(400, 'invalid_input');
      if (file.size > MAX_UPLOAD_SIZE) return jsonError(413, 'file_too_large');
      await writableChannel(actor, channelId);
      const name = cleanFileName((file as File).name) || 'file';
      const mime = file.type || 'application/octet-stream';
      let url: string;
      try {
        url = await saveUpload('docs', name, mime, Buffer.from(await file.arrayBuffer()));
      } catch (err) {
        if (err instanceof UploadError) return jsonError(err.status, err.code);
        throw err;
      }
      return NextResponse.json(await addFile(actor, channelId, { url, name, mime, size: file.size }), { status: 201 });
    },
    { write: 'upload', limit: 60 },
  );
}
