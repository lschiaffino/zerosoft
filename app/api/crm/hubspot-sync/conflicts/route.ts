import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { conflictDetail, dismissConflict, listConflicts, resolveAllConflicts, resolveConflict, type ConflictObject, type ResolveResult } from '@/lib/crm-hubspot-sync/conflicts';
import { syncAdmin } from '@/lib/crm-hubspot-sync/http';
import { crmError, limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const objectSchema = z.enum(['contact', 'company', 'deal', 'activity']);
const recordId = z.string().min(1).max(64);
const keepSchema = z.enum(['here', 'hubspot']);
const fieldName = z.string().min(1).max(120);

const bodySchema = z.union([
  z.object({ action: z.literal('detail'), object: objectSchema, recordId }).strict(),
  z
    .object({
      action: z.literal('resolve'),
      object: objectSchema,
      recordId,
      keep: z.record(fieldName, keepSchema).refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 80),
    })
    .strict(),
  z.object({ action: z.literal('resolve_all'), keep: keepSchema, object: z.enum(['contact', 'company', 'deal']).optional() }).strict(),
  z.object({ action: z.literal('dismiss'), object: objectSchema, recordId }).strict(),
]);

/**
 * Conflictos del sync con HubSpot (solo admins): qué registros tienen campos
 * cambiados de los dos lados, con los nombres de los campos. ?object= filtra,
 * ?offset= pagina.
 */
export async function GET(req: NextRequest) {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  const object = objectSchema.safeParse(req.nextUrl.searchParams.get('object') ?? undefined);
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? 0);
  return NextResponse.json({
    conflicts: await listConflicts(a.ws, { object: object.success ? (object.data as ConflictObject) : undefined, offset: Number.isFinite(offset) ? Math.floor(offset) : 0 }),
  });
}

function respond(res: ResolveResult): NextResponse {
  if (res.ok) return NextResponse.json(res);
  return crmError(res.code === 'not_found' ? 404 : res.code === 'hubspot_busy' ? 429 : 409, res.code);
}

/**
 * { action: 'detail' }: lo de cada lado, leído ahora de HubSpot (los valores
 * van solo en la respuesta, nunca se guardan). { action: 'resolve', keep:
 * { campo: 'here' | 'hubspot' } }: deja ese lado en cada campo. {
 * action: 'resolve_all', keep }: lo mismo para una tanda de registros. {
 * action: 'dismiss' }: saca de la lista, sin tocar valores, uno que no se
 * resuelve por campo (fusión, actividad, registro que ya no está vinculado).
 * Nunca escribe en HubSpot: lo que queda de acá sale por la escritura (S3) si
 * está prendida. Solo admins.
 */
export async function POST(req: NextRequest) {
  const a = await syncAdmin();
  if (a instanceof NextResponse) return a;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const body = parsed.data;
  const limited = await limitAction(a.me, 'hubspot-sync-conflicts', 600, 3600);
  if (limited) return limited;
  if (body.action === 'detail') {
    const res = await conflictDetail(a.ws, body.object, body.recordId);
    if (res.ok) return NextResponse.json(res);
    return crmError(res.code === 'not_found' ? 404 : res.code === 'hubspot_busy' ? 429 : 409, res.code);
  }
  if (body.action === 'resolve') return respond(await resolveConflict(a.ws, body.object, body.recordId, body.keep));
  if (body.action === 'resolve_all') return respond(await resolveAllConflicts(a.ws, body.keep, body.object));
  const dismissed = await dismissConflict(a.ws, body.object, body.recordId);
  if (dismissed === 'not_found') return crmError(404, 'not_found');
  if (dismissed === 'not_resolvable') return crmError(409, 'resolve_first');
  return NextResponse.json({ ok: true });
}
