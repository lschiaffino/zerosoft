import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createDocument, listDocuments } from '@/lib/crm-media';
import { json, mediaFail, mediaUser, storeMultipart } from '@/lib/crm-media-http';
import { crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await mediaUser();
  if ('res' in u) return u.res;
  return json({ rows: await listDocuments(u.user.id, req.nextUrl.searchParams.get('q') ?? '') });
}

const registerSchema = z.object({
  name: z.string().trim().max(200).default(''),
  filename: z.string().trim().min(1).max(255),
  url: z.string().trim().min(1).max(2000),
  size: z.number().int().min(0),
});

/** Sube un PDF (multipart `file` + `name`) o registra uno ya subido a Blob ({ name, filename, url, size }). */
export async function POST(req: NextRequest) {
  const u = await mediaUser();
  if ('res' in u) return u.res;
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const stored = await storeMultipart(await req.formData().catch(() => null), 'document');
      const doc = await createDocument(u.user.id, {
        name: stored.fields.name ?? '',
        filename: stored.filename,
        url: stored.url,
        size: stored.size,
        createdBy: u.actor,
      });
      return json(doc, 201);
    }
    const parsed = registerSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return crmError(400, 'invalid_input');
    return json(await createDocument(u.user.id, { ...parsed.data, createdBy: u.actor }), 201);
  } catch (err) {
    return mediaFail(err);
  }
}
