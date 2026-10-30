import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { contentDisposition } from '@/lib/docs-files';
import { getCandidateProfile } from '@/lib/hiring/candidates';
import { readHiringFile } from '@/lib/hiring/files';
import { hiringActor, hJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET (?doc=<id>, ?download=1): el CV (o un documento adicional), solo para
 * quien ve al candidato. Los archivos son privados (lib/hiring/files.ts) y se
 * sirven desde acá: PDF en el navegador, DOC y DOCX como descarga.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const id = (await params).id;
  const profile = await getCandidateProfile(a.actor, id);
  if (!profile) return hJson({ error: 'not_found' }, 404);
  const docId = req.nextUrl.searchParams.get('doc');
  let file: { ref: string | null; name: string | null; mime: string | null } | undefined;
  if (docId) {
    // Solo documentos que el perfil ya muestra (los de postulaciones visibles).
    if (!profile.documents.some((d) => d.id === docId)) return hJson({ error: 'not_found' }, 404);
    file = (await getDb().prepare('SELECT ref, name, mime FROM hiring_documents WHERE id = ? AND candidate_id = ?').get(docId, id)) as typeof file;
  } else {
    file = (await getDb().prepare('SELECT resume_url AS ref, resume_name AS name, resume_mime AS mime FROM hiring_candidates WHERE id = ? AND workspace_id = ?').get(id, a.actor.ws)) as typeof file;
  }
  if (!file?.ref) return hJson({ error: 'not_found' }, 404);
  const bytes = await readHiringFile(file.ref);
  if (!bytes) return hJson({ error: 'not_found' }, 404);
  const pdf = file.mime === 'application/pdf';
  const inline = pdf && req.nextUrl.searchParams.get('download') !== '1';
  return new NextResponse(new Uint8Array(bytes) as BodyInit, {
    headers: {
      'Content-Type': inline ? 'application/pdf' : 'application/octet-stream',
      'Content-Disposition': contentDisposition(file.name || 'resume', inline),
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': inline ? "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'" : "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
