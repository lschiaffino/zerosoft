import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInbound, setInboundObjects, setInboundPaused, startInbound, type InboundActionResult } from '@/lib/crm-hubspot-sync/inbound';
import { syncAdmin } from '@/lib/crm-hubspot-sync/http';
import { crmError, limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const objects = z
  .object({
    companies: z.boolean(),
    contacts: z.boolean(),
    deals: z.boolean(),
    notes: z.boolean(),
    calls: z.boolean(),
    meetings: z.boolean(),
    tasks: z.boolean(),
    emails: z.boolean(),
  })
  .partial()
  .strict();

const bodySchema = z.union([
  z.object({ action: z.literal('start'), objects: objects.optional() }).strict(),
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('objects'), objects }).strict(),
]);

/**
 * Sync HubSpot → CRM (solo admins): en qué está, conteos por objeto, cuándo
 * corrió y los códigos de los últimos problemas. Nunca datos de registros.
 */
export async function GET() {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ inbound: await getInbound(a.ws) });
}

function respond(res: InboundActionResult): NextResponse {
  if (res.ok) return NextResponse.json({ inbound: res.inbound });
  if (res.missing) return NextResponse.json({ error: res.code, missing: res.missing }, { status: 409 });
  return crmError(409, res.code);
}

/**
 * { action: 'start' }: arranca (o retoma) el sync de HubSpot hacia el CRM. Lo
 * que ya está vinculado no se vuelve a crear. { action: 'pause' | 'resume' }.
 * { action: 'objects', objects }: qué objetos se traen. Nada se escribe en
 * HubSpot. Solo admins.
 */
export async function POST(req: NextRequest) {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  const limited = await limitAction(a.me, 'hubspot-sync-inbound', 120, 3600);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const body = parsed.data;
  if (body.action === 'start') return respond(await startInbound(a.ws, a.me, body.objects));
  if (body.action === 'objects') return respond(await setInboundObjects(a.ws, body.objects));
  return respond(await setInboundPaused(a.ws, a.me, body.action === 'pause'));
}
