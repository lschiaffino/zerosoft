/**
 * Endpoints públicos de Analytics (sin sesión): /api/ingest/e (eventos, uno
 * o en lote), /api/ingest/decide (flags) y /api/ingest/delete (borrar una
 * persona con la key secreta). Tienen que ser baratos: validar, una lectura
 * de personas y un batch de escritura. CORS abierto (el snippet corre en el
 * sitio del cliente); el origen se controla con la lista de dominios.
 */
import { NextResponse } from 'next/server';
import { extractBearer } from '../api-auth';
import { rateLimit } from '../rate-limit';
import { INGEST_LIMITS, originAllowed, parseIngestBody } from './ingest-core';
import { requestContext, storeEvents } from './ingest';
import { parseDomainList, projectByKey, type ProjectRow } from './projects';
import { decideFlags } from './flags';
import { deletePerson, personIdByDistinctId } from './persons';

/** Pedidos por minuto por proyecto (cada pedido trae hasta 200 eventos). */
const INGEST_RPM = Number(process.env.ANALYTICS_INGEST_RPM) || 1200;
const DECIDE_RPM = Number(process.env.ANALYTICS_DECIDE_RPM) || 2400;

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function reply(req: Request, status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Cuerpo con tope de tamaño (sin leer de más si content-length ya lo pasa). */
async function readBody(req: Request): Promise<string | null> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > INGEST_LIMITS.maxBodyBytes) return null;
  const text = await req.text().catch(() => '');
  return text.length > INGEST_LIMITS.maxBodyBytes ? null : text;
}

type Resolved = { project: ProjectRow; secret: boolean } | { res: NextResponse };

/**
 * Proyecto del pedido: key secreta (Authorization: Bearer zss_…, para
 * servidores: sin chequeo de origen) o key pública del cuerpo (con la lista de
 * dominios permitidos y Do Not Track).
 */
async function resolveProject(req: Request, bodyKey: string | null): Promise<Resolved> {
  const bearer = extractBearer(req);
  if (bearer?.startsWith('zss_')) {
    const project = await projectByKey(bearer, 'secret');
    return project ? { project, secret: true } : { res: reply(req, 401, { error: 'invalid_key' }) };
  }
  if (!bodyKey) return { res: reply(req, 401, { error: 'missing_key' }) };
  const project = await projectByKey(bodyKey, 'public');
  if (!project) return { res: reply(req, 401, { error: 'invalid_key' }) };
  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  if (!originAllowed(origin, parseDomainList(project.allowed_domains))) return { res: reply(req, 403, { error: 'origin_not_allowed' }) };
  return { project, secret: false };
}

function dntOn(req: Request): boolean {
  return req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1';
}

async function limited(req: Request, bucket: string, projectId: string, rpm: number): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  const r = await rateLimit(`${bucket}:${projectId}`, rpm, 60);
  if (r.ok) return null;
  const res = reply(req, 429, { error: 'rate_limited' });
  res.headers.set('retry-after', String(Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))));
  return res;
}

export async function handleCapture(req: Request): Promise<Response> {
  const text = await readBody(req);
  if (text === null) return reply(req, 413, { error: 'payload_too_large' });
  const parsed = parseIngestBody(text);
  if (!parsed.ok) return reply(req, 400, { error: parsed.error });
  const r = await resolveProject(req, parsed.apiKey);
  if ('res' in r) return r.res;
  // Do Not Track / GPC del navegador: con el ajuste prendido no se guarda nada.
  if (!r.secret && r.project.respect_dnt === 1 && dntOn(req)) return reply(req, 200, { status: 1, stored: 0, dropped: parsed.events.length, reason: 'dnt' });
  const block = await limited(req, 'aingest', r.project.id, INGEST_RPM);
  if (block) return block;
  // Un servidor con la key secreta no es el navegador de la persona: sin user agent ni IP del pedido.
  const ctx = r.secret ? null : requestContext(req);
  const stored = await storeEvents(r.project, parsed.events, ctx);
  return reply(req, 200, { status: 1, stored, dropped: parsed.dropped + (parsed.events.length - stored) });
}

export async function handleDecide(req: Request): Promise<Response> {
  const text = await readBody(req);
  if (text === null) return reply(req, 413, { error: 'payload_too_large' });
  let body: Record<string, unknown>;
  try {
    const v = JSON.parse(text || '{}');
    body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return reply(req, 400, { error: 'invalid_json' });
  }
  const key = typeof body.api_key === 'string' ? body.api_key : typeof body.token === 'string' ? body.token : null;
  const r = await resolveProject(req, key);
  if ('res' in r) return r.res;
  const block = await limited(req, 'adecide', r.project.id, DECIDE_RPM);
  if (block) return block;
  const distinctId = typeof body.distinct_id === 'string' ? body.distinct_id.slice(0, INGEST_LIMITS.maxDistinctId) : '';
  const overrides = body.person_properties && typeof body.person_properties === 'object' && !Array.isArray(body.person_properties) ? (body.person_properties as Record<string, unknown>) : {};
  const featureFlags = distinctId ? await decideFlags(r.project.id, distinctId, overrides) : {};
  return reply(req, 200, {
    featureFlags,
    config: {
      autocapture: r.project.autocapture === 1,
      respectDnt: r.project.respect_dnt === 1,
    },
  });
}

/** Borra la persona de un distinct_id con todos sus eventos. Solo con la key secreta. */
export async function handleDeletePerson(req: Request): Promise<Response> {
  const bearer = extractBearer(req);
  if (!bearer?.startsWith('zss_')) return reply(req, 401, { error: 'secret_key_required' });
  const project = await projectByKey(bearer, 'secret');
  if (!project) return reply(req, 401, { error: 'invalid_key' });
  const block = await limited(req, 'adelete', project.id, 120);
  if (block) return block;
  const text = await readBody(req);
  let distinctId = '';
  try {
    const v = JSON.parse(text || '{}');
    distinctId = typeof v?.distinct_id === 'string' ? v.distinct_id.slice(0, INGEST_LIMITS.maxDistinctId) : '';
  } catch {
    return reply(req, 400, { error: 'invalid_json' });
  }
  if (!distinctId) return reply(req, 400, { error: 'distinct_id_required' });
  const personId = await personIdByDistinctId(project.id, distinctId);
  if (!personId) return reply(req, 404, { error: 'person_not_found' });
  const res = await deletePerson(project.id, personId);
  return reply(req, 200, { deleted: res.deleted, events: res.events });
}
