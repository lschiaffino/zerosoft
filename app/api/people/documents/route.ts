import { NextRequest } from 'next/server';
import { linkDocsPage, listDocuments, uploadDocument } from '@/lib/people-docs';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?employeeId=: documentos de una ficha (sin employeeId: políticas generales). */
export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ documents: await listDocuments(ctx, req.nextUrl.searchParams.get('employeeId') || null) }));
}

/** POST multipart (file, title, kind, visibility, requiresAck, employeeId) o JSON { docsPageId, title, requiresAck }. */
export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!form || !(file instanceof File)) return pjson({ error: 'file_required' }, 400);
      if (file.size > 15 * 1024 * 1024) return pjson({ error: 'file_too_large' }, 413);
      const doc = await uploadDocument(ctx, String(form.get('employeeId') ?? '') || null, { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) }, {
        title: String(form.get('title') ?? ''),
        kind: String(form.get('kind') ?? ''),
        visibility: String(form.get('visibility') ?? ''),
        requiresAck: form.get('requiresAck') === '1' || form.get('requiresAck') === 'true',
      });
      return pjson({ document: doc }, 201);
    }
    const b = await readJson(req);
    return pjson({ document: await linkDocsPage(ctx, { docsPageId: String(b.docsPageId ?? ''), title: typeof b.title === 'string' ? b.title : undefined, requiresAck: b.requiresAck !== false, employeeId: typeof b.employeeId === 'string' ? b.employeeId : null }) }, 201);
  });
}
