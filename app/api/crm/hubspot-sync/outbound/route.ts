import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { REQUEST_STEP_BUDGET_MS, getOutbound, previewOutbound, runOutboundStep, setOutboundMode, type OutboundActionResult } from '@/lib/crm-hubspot-sync/outbound';
import { syncAdmin } from '@/lib/crm-hubspot-sync/http';
import { crmError, limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.union([
  z.object({ action: z.literal('preview') }).strict(),
  z.object({ action: z.literal('enable') }).strict(),
  z.object({ action: z.literal('disable') }).strict(),
  z.object({ action: z.literal('run') }).strict(),
]);

/**
 * Escritura del CRM a HubSpot (solo admins): si está prendida, qué espera en
 * la cola, conteos por objeto, la última vista previa (nombres de campos y
 * conteos) y los códigos de los últimos problemas. Nunca datos de registros.
 */
export async function GET() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ outbound: await getOutbound(a.ws) });
}

function respond(res: OutboundActionResult): NextResponse {
  if (res.ok) return NextResponse.json({ outbound: res.outbound });
  if (res.missing) return NextResponse.json({ error: res.code, missing: res.missing }, { status: 409 });
  return crmError(409, res.code);
}

/**
 * { action: 'preview' }: la vista previa de lo que saldría (no llama a
 * HubSpot). { action: 'enable' }: prende la escritura (pide una vista previa
 * de la última hora). { action: 'disable' }: la apaga. { action: 'run' }:
 * vacía un tramo de la cola ahora (la pantalla abierta; si no, el cron).
 * Solo admins.
 */
export async function POST(req: NextRequest) {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const { action } = parsed.data;
  // Apagar nunca se frena; la pantalla abierta empuja tramos con su propia cuenta.
  if (action !== 'disable') {
    const limited = await limitAction(a.me, action === 'run' ? 'hubspot-sync-outbound-run' : 'hubspot-sync-outbound', action === 'run' ? 1200 : 120, 3600);
    if (limited) return limited;
  }
  if (action === 'preview') return respond(await previewOutbound(a.ws));
  if (action === 'run') {
    await runOutboundStep(a.ws, { budgetMs: REQUEST_STEP_BUDGET_MS });
    return NextResponse.json({ outbound: await getOutbound(a.ws) });
  }
  return respond(await setOutboundMode(a.ws, a.me, action === 'enable'));
}
