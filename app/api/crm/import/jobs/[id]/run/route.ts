import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getImportJob, runImportStep } from '@/lib/crm-import-jobs';
import { forbidden, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Avanza el import un tramo (unos 20 s) mientras la pantalla de progreso está
 * abierta. El cron de cada minuto hace lo mismo con la pestaña cerrada; el
 * reclamo del job evita que corran los dos a la vez.
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const job = await getImportJob(user.id, id);
  if (!job) return notFound();
  if (job.status === 'queued' || job.status === 'running') await runImportStep(id, { budgetMs: 20_000 }).catch(() => null);
  return NextResponse.json(await getImportJob(user.id, id));
}
