import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getAgentAnalytics, parseAnalyticsRange } from '@/lib/agents-analytics';
import { rememberAlertLocale, setAgentAlertsEnabled } from '@/lib/agents-alerts';
import { agentError, canEditAgent, forbidden, notFound, unauthorized, visibleAgentRow } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Pestaña Analítica: métricas de los últimos ?days=7|30|90 (default 30) y si
 * las alertas por email están prendidas. ?locale= guarda el idioma del email.
 */
export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await visibleAgentRow(user, id);
  if (!row) return notFound();
  const locale = req.nextUrl.searchParams.get('locale');
  if (locale && canEditAgent(user, row)) await rememberAlertLocale(id, locale).catch(() => {});
  const analytics = await getAgentAnalytics(user.id, id, parseAnalyticsRange(req.nextUrl.searchParams.get('days')));
  return NextResponse.json({ analytics, alertsEnabled: (row.alerts_enabled ?? 1) === 1 });
}

const patchSchema = z.object({
  alertsEnabled: z.boolean(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

/** Prende o apaga las alertas por email del agente (admins y owners). */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const accessRow = await visibleAgentRow(user, id);
  if (!accessRow) return notFound();
  if (!canEditAgent(user, accessRow)) return forbidden();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  if (!(await setAgentAlertsEnabled(user.id, id, parsed.data.alertsEnabled))) return notFound();
  if (parsed.data.locale) await rememberAlertLocale(id, parsed.data.locale).catch(() => {});
  return NextResponse.json({ alertsEnabled: parsed.data.alertsEnabled });
}
