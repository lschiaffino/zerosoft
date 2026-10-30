import { NextRequest } from 'next/server';
import { getEmployeeRow, PeopleError, setPhoto } from '@/lib/people';
import { sniffRaster } from '@/lib/shop';
import { saveUpload } from '@/lib/uploads';
import { fileBlockResponse } from '@/lib/upload-serve';
import type { DocsBlock } from '@/lib/docs-types';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: la foto (carpeta privada; cualquiera del workspace con People la ve). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    const r = await getEmployeeRow(ctx.ws, id);
    if (!r?.photo_url) return pjson({ error: 'not_found' }, 404);
    const block = { id, type: 'image', content: '', url: r.photo_url, name: 'photo', mime: '' } as unknown as DocsBlock & { url: string };
    return (await fileBlockResponse(block)) ?? pjson({ error: 'not_found' }, 404);
  });
}

/** POST multipart (file): foto de la ficha. El tipo sale de los bytes (PNG, JPEG, GIF, WebP o AVIF; nunca SVG). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return pjson({ error: 'file_required' }, 400);
    if (file.size > 5 * 1024 * 1024) return pjson({ error: 'file_too_large' }, 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = sniffRaster(new Uint8Array(buffer.subarray(0, 32)));
    if (!kind) throw new PeopleError('image_type', 415);
    if (!(await getEmployeeRow(ctx.ws, id))) return pjson({ error: 'not_found' }, 404);
    const url = await saveUpload('people', `photo.${kind.ext}`, kind.mime, buffer);
    await setPhoto(ctx, id, url);
    return pjson({ ok: true });
  });
}
