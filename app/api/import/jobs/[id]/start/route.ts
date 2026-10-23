import { NextRequest, NextResponse } from 'next/server';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import { importError, importJobFor } from '@/lib/import-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Confirmar la vista previa: empieza a escribir (y corre la primera tanda). */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const res = await importJobFor((await props.params).id);
  if (res instanceof NextResponse) return res;
  if (!(await startImportJob(res.job))) return importError(409, 'not_ready');
  return NextResponse.json({ job: await runImportJob(res.job.id, 12_000) });
}
