import { NextRequest, NextResponse } from 'next/server';
import { updateImportJob } from '@/lib/import-jobs';
import { runImportJob } from '@/lib/import-runner';
import { importError, importJobFor } from '@/lib/import-http';
import { localUploadedBytes } from '@/lib/docs-notion-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Avanza el import un tramo (~15 s). La pestaña lo llama en loop mientras se
 * mira el progreso; si se cierra, sigue el cron de cada minuto. Con
 * { uploaded: true } cierra la subida por partes y arranca la lectura.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const res = await importJobFor((await props.params).id);
  if (res instanceof NextResponse) return res;
  const { job } = res;
  const body = (await req.json().catch(() => ({}))) as { uploaded?: boolean };
  if (job.status === 'uploading') {
    if (!body.uploaded) return importError(409, 'upload_pending');
    const size = await localUploadedBytes(job.id);
    if (size === 0 || size !== Number(job.options.size)) return importError(409, 'upload_incomplete');
    await updateImportJob(job.id, { status: 'fetching' });
  }
  return NextResponse.json({ job: await runImportJob(job.id, 15_000) });
}
