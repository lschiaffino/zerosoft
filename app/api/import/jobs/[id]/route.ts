import { NextRequest, NextResponse } from 'next/server';
import { jobView } from '@/lib/import-jobs';
import { cancelImportJob } from '@/lib/import-runner';
import { importJobFor, viewFor } from '@/lib/import-http';
import { localUploadedBytes } from '@/lib/docs-notion-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado del import (progreso, vista previa o reporte). Sin token ni payload. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const res = await importJobFor((await props.params).id);
  if (res instanceof NextResponse) return res;
  const uploaded = res.job.status === 'uploading' ? await localUploadedBytes(res.job.id) : undefined;
  return NextResponse.json({ job: await viewFor(res.user, jobView(res.job)), uploaded });
}

/** Cancelar: borra el token y lo subido. Lo que ya se escribió queda. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const res = await importJobFor((await props.params).id);
  if (res instanceof NextResponse) return res;
  await cancelImportJob(res.job);
  return NextResponse.json({ ok: true });
}
