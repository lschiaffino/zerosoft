import { NextRequest, NextResponse } from 'next/server';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import { importError, importJobFor } from '@/lib/import-http';
import { updateImportJob } from '@/lib/import-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Confirmar la vista previa: empieza a escribir (y corre la primera tanda). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const res = await importJobFor((await props.params).id);
  if (res instanceof NextResponse) return res;
  // Notion por API: qué traer (páginas, bases, archivos), elegido en la vista previa.
  if (res.job.source === 'notion_api' && res.job.status === 'preview') {
    const body = (await req.json().catch(() => ({}))) as { include?: Record<string, unknown> };
    const inc = body.include ?? {};
    const include = { pages: inc.pages !== false, databases: inc.databases !== false, files: inc.files !== false };
    if (!include.pages && !include.databases) return importError(400, 'nothing_selected');
    await updateImportJob(res.job.id, { options: { ...res.job.options, include }, onlyIf: 'preview' });
  }
  if (!(await startImportJob(res.job))) return importError(409, 'not_ready');
  return NextResponse.json({ job: await runImportJob(res.job.id, 12_000) });
}
