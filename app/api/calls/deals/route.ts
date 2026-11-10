import { NextRequest } from 'next/server';
import { dealsOverview, searchDeals } from '@/lib/calls/crm';
import { callsActor, cJson } from '@/lib/calls/http';
import { sessionScope } from '@/lib/crm-visibility';
import { userCanUseApp } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: deals abiertos con llamadas y sus señales de riesgo. Con ?q= (o
 * ?options=1), deals abiertos por nombre para vincular una llamada.
 */
export async function GET(req: NextRequest) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  // Los deals son del CRM: sin la app, no hay deals que mostrar.
  if (!userCanUseApp(a.user, 'crm')) return cJson({ deals: [] });
  const scope = await sessionScope(a.user);
  const sp = req.nextUrl.searchParams;
  if (sp.has('q') || sp.get('options') === '1') return cJson({ deals: await searchDeals(a.actor, scope, sp.get('q') ?? '') });
  return cJson({ deals: await dealsOverview(a.actor, scope) });
}
