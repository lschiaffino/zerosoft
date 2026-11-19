import { NextResponse } from 'next/server';
import { REQUEST_STEP_BUDGET_MS, getPreview, runPreviewStep } from '@/lib/crm-hubspot-sync/preview';
import { syncAdmin } from '@/lib/crm-hubspot-sync/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Avanza un tramo de la vista previa (lo llama la pantalla mientras está
 * abierta; con la pestaña cerrada sigue el cron) y devuelve cómo quedó. Solo
 * admins.
 */
export async function POST() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  await runPreviewStep(a.ws, { budgetMs: REQUEST_STEP_BUDGET_MS });
  return NextResponse.json({ preview: await getPreview(a.ws) });
}
