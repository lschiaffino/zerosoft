import { NextResponse } from 'next/server';
import { REQUEST_STEP_BUDGET_MS, getInbound, runInboundStep } from '@/lib/crm-hubspot-sync/inbound';
import { syncAdmin } from '@/lib/crm-hubspot-sync/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Avanza un tramo del sync HubSpot → CRM (lo llama la pantalla mientras trae
 * todo la primera vez; con la pestaña cerrada sigue el cron) y devuelve cómo
 * quedó. Respeta la pausa y las esperas por los límites de HubSpot. Solo admins.
 */
export async function POST() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  await runInboundStep(a.ws, { budgetMs: REQUEST_STEP_BUDGET_MS });
  return NextResponse.json({ inbound: await getInbound(a.ws) });
}
