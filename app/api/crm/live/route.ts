import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { LIVE_ENTITIES, MAX_LIVE_IDS, listSignature, recordSignature } from '@/lib/crm-live';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z.string().min(1).max(80);
const liveSchema = z.union([
  z.object({
    /** Tabla o board: las filas que la persona tiene en pantalla. */
    list: z.enum(LIVE_ENTITIES),
    ids: z.array(id).max(MAX_LIVE_IDS).optional(),
    pipelineId: id.optional(),
  }),
  z.object({
    /** Ficha o vista previa de un registro. */
    record: z.object({ kind: z.enum(['contact', 'company', 'deal']), id }),
  }),
]);

/**
 * CRM en vivo (sin websockets, como Track): devuelve una firma que cambia
 * cuando un compañero cambia algo que esta persona ve, y la vista recarga por
 * sus rutas de siempre (que aplican el alcance). Nunca devuelve datos: la firma
 * se arma solo con los registros y campos que ve (lib/crm-live.ts).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = liveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const viewer = sessionFieldViewer(user);
  const scope = await sessionScope(user);
  const body = parsed.data;
  if ('record' in body) {
    const sig = await recordSignature(viewer, scope, body.record.kind, body.record.id);
    if (sig === null) return notFound();
    return NextResponse.json({ sig });
  }
  return NextResponse.json({ sig: await listSignature(viewer, scope, body.list, { ids: body.ids, pipelineId: body.pipelineId }) });
}
