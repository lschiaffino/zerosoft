import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { connectSync, connectSyncFromLines, disconnectSync, getSyncStatus, recheckSync, type ConnectResult } from '@/lib/crm-hubspot-sync/connection';
import { syncAdmin } from '@/lib/crm-hubspot-sync/http';
import { crmError, limitAction, notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.union([
  z.object({ token: z.string().trim().min(4).max(500) }).strict(),
  z.object({ useLinesKey: z.literal(true) }).strict(),
  z.object({ recheck: z.literal(true) }).strict(),
]);

/**
 * Estado de la conexión del CRM con HubSpot para el sync (solo admins): la
 * cuenta, el tipo de clave, sus permisos, cuándo se revisó por última vez y
 * los ajustes del sync. La clave nunca vuelve.
 */
export async function GET() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  return NextResponse.json(await getSyncStatus(a.ws));
}

function respond(res: ConnectResult): NextResponse {
  if (res.ok) return NextResponse.json(res.status);
  // Los permisos que faltan van por nombre, para decirlos en palabras. Nunca datos ni la clave.
  if (res.code === 'missing_scope') return NextResponse.json({ error: res.code, missing: res.missing ?? [] }, { status: 400 });
  const status = res.code === 'provider_error' ? 502 : res.code === 'hubspot_busy' ? 503 : res.code === 'invalid_token' ? 400 : 409;
  return crmError(status, res.code);
}

/**
 * { token }: conecta con una service key o el token de una private app
 * heredada. { useLinesKey: true }: usa la clave que el workspace ya conectó en
 * Lines, sin que pase por el navegador. { recheck: true }: vuelve a validar la
 * clave guardada. Solo admins. Nada se escribe en HubSpot.
 */
export async function POST(req: NextRequest) {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  const limited = await limitAction(a.me, 'hubspot-sync-connect', 30, 3600);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const body = parsed.data;
  try {
    if ('token' in body) return respond(await connectSync(a.ws, a.me, body.token));
    if ('useLinesKey' in body) return respond(await connectSyncFromLines(a.ws, a.me));
    return respond(await recheckSync(a.ws));
  } catch {
    // Sin detalles: un error de acá no debe arrastrar nada de la clave a un log ni a la respuesta.
    return crmError(502, 'provider_error');
  }
}

/** Desconecta: borra la clave guardada y descarta la vista previa. Solo admins. */
export async function DELETE() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  return (await disconnectSync(a.ws, a.me)) ? NextResponse.json({ ok: true }) : notFound();
}
