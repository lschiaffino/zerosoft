import { NextResponse } from 'next/server';
import { cancelPreview, getPreview, startPreview } from '@/lib/crm-hubspot-sync/preview';
import { syncAdmin } from '@/lib/crm-hubspot-sync/http';
import { crmError, limitAction, notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * La vista previa del sync con HubSpot (solo admins): en qué etapa va o, si
 * terminó, el informe con conteos y muestras de registros de todo el
 * workspace.
 */
export async function GET() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ preview: await getPreview(a.ws) });
}

/** Arranca una vista previa nueva (reemplaza la anterior). Solo lee: no escribe en HubSpot ni en el CRM. */
export async function POST() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  const limited = await limitAction(a.me, 'hubspot-sync-preview', 30, 3600);
  if (limited) return limited;
  const res = await startPreview(a.ws, a.me);
  if (!res.ok) return res.missing ? NextResponse.json({ error: res.code, missing: res.missing }, { status: 409 }) : crmError(409, res.code);
  return NextResponse.json({ preview: res.preview }, { status: 201 });
}

/** Cancela la vista previa en curso. */
export async function DELETE() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  if (!(await cancelPreview(a.ws))) return notFound();
  return NextResponse.json({ preview: await getPreview(a.ws) });
}
