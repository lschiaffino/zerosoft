import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createDocument, deleteDocument, listDocuments, startUpload, versionDto, versionFromPdf } from '@/lib/send/core';
import { docsPageVersion } from '@/lib/send/docs';
import { parseBody, sendActor, sendLimit, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().trim().max(200).optional(),
  // Subir un archivo: se crea la versión y el navegador manda las partes.
  file: z.object({ name: z.string().min(1).max(200), mime: z.string().max(120), size: z.number().int().positive() }).optional(),
  // O una página de Docs.
  docsPageId: z.string().max(80).optional(),
});

/** GET ?q=: documentos que la persona ve. */
export async function GET(req: NextRequest) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  return sJson({ documents: await listDocuments(a.actor, { q: req.nextUrl.searchParams.get('q') ?? '' }) });
}

/** POST: documento nuevo con su primera versión. */
export async function POST(req: NextRequest) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  const limited = await sendLimit(req, 'create', 120, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const input = await parseBody(req, schema);
    if (!input.file && !input.docsPageId) return sJson({ error: 'invalid_input' }, 400);
    if (input.docsPageId) {
      const page = await docsPageVersion(a.user, a.actor, input.docsPageId);
      const doc = await createDocument(a.actor, input.title || page.title);
      const version = await versionFromPdf(a.actor, doc.id, page.bytes, page.name, 'docs', input.docsPageId);
      return sJson({ document: { id: doc.id, title: doc.title }, version: versionDto(version, null) }, 201);
    }
    const file = input.file!;
    const doc = await createDocument(a.actor, input.title || file.name.replace(/\.[a-z0-9]+$/i, ''));
    try {
      const version = await startUpload(a.actor, doc.id, file);
      return sJson({ document: { id: doc.id, title: doc.title }, version: versionDto(version, null) }, 201);
    } catch (err) {
      await deleteDocument(a.actor, doc.id).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    return sFail(err);
  }
}
