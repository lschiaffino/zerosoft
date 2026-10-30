import { NextRequest } from 'next/server';
import { deleteDocument, getDocumentFile } from '@/lib/people-docs';
import { fileBlockResponse } from '@/lib/upload-serve';
import type { DocsBlock } from '@/lib/docs-types';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: el archivo, solo a quien lo puede ver (HR, o la persona si se lo compartieron). */
export async function GET(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    const file = await getDocumentFile(ctx, id);
    if (!file) return pjson({ error: 'not_found' }, 404);
    const block = { id, type: 'file', content: '', url: file.url, name: file.name, mime: file.mime } as unknown as DocsBlock & { url: string };
    return (await fileBlockResponse(block, { download: req.nextUrl.searchParams.get('download') === '1', range: req.headers.get('range') })) ?? pjson({ error: 'not_found' }, 404);
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteDocument(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
