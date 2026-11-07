import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireEditDocument, startUpload, versionDto, versionFromPdf } from '@/lib/send/core';
import { docsPageVersion } from '@/lib/send/docs';
import { parseBody, sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  file: z.object({ name: z.string().min(1).max(200), mime: z.string().max(120), size: z.number().int().positive() }).optional(),
  docsPageId: z.string().max(80).optional(),
});

/** POST: reemplaza el archivo. Los links siguen iguales y muestran la versión nueva cuando está lista. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const d = await requireEditDocument(a.actor, id);
    const input = await parseBody(req, schema);
    if (input.docsPageId) {
      const page = await docsPageVersion(a.user, a.actor, input.docsPageId);
      return sJson({ version: versionDto(await versionFromPdf(a.actor, d.id, page.bytes, page.name, 'docs', input.docsPageId), d.current_version_id) }, 201);
    }
    if (!input.file) return sJson({ error: 'invalid_input' }, 400);
    return sJson({ version: versionDto(await startUpload(a.actor, d.id, input.file), d.current_version_id) }, 201);
  } catch (err) {
    return sFail(err);
  }
}
