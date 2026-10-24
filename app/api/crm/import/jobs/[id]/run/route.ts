import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getImportJob, REQUEST_PAGE_SIZE, REQUEST_STEP_BUDGET_MS, runImportStep } from '@/lib/crm-import-jobs';
import { forbidden, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Avanza el import un tramo corto (unos 4 s, de a páginas de 50) mientras la
 * pantalla de progreso está abierta: así no frena al resto del servidor y
 * cancelar no espera. El cron de cada minuto sigue con la pestaña cerrada (con
 * más presupuesto); el reclamo del job evita que corran los dos a la vez.
 */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const job = await getImportJob(user.id, id);
  if (!job) return notFound();
  if (job.status === 'queued' || job.status === 'running') await runImportStep(id, { budgetMs: REQUEST_STEP_BUDGET_MS, pageSize: REQUEST_PAGE_SIZE }).catch(() => null);
  return NextResponse.json(await getImportJob(user.id, id));
}
