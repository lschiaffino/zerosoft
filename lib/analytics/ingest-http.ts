/**
 * Endpoints públicos de Analytics (sin sesión): /api/ingest/e (eventos, uno
 * o en lote), /api/ingest/decide (flags) y /api/ingest/delete (borrar una
 * persona con la key secreta). Tienen que ser baratos: validar, una lectura
 * de personas y un batch de escritura. CORS abierto (el snippet corre en el
 * sitio del cliente); el origen se controla con la lista de dominios.
 */
import { gunzipSync } from 'zlib';
import { NextResponse } from 'next/server';
import { extractBearer } from '../api-auth';
import { ensureMigrated, getClient, getDb } from '../db';
import { clientIp } from '../rate-limit';
import { isBotUserAgent } from './bots';
import { applyCookieless, cookielessIdFor, isCookielessId } from './cookieless';
import { INGEST_LIMITS, originAllowed, parseIngestBody } from './ingest-core';
import { requestContext, storeEvents } from './ingest';
import { parseDomainList, projectByKey, type ProjectRow } from './projects';
import { decideFlagsFull, projectFlags } from './flags';
import { capSpecialEvents } from './ingest-special';
import { hasLivePopover, surveysFor } from './surveys';
import { deletePerson, personIdByDistinctId } from './persons';
import { replayConfig } from './replay-core';

/** Pedidos por minuto por proyecto (cada pedido trae hasta 200 eventos). */
const INGEST_RPM = Number(process.env.ANALYTICS_INGEST_RPM) || 1200;
const DECIDE_RPM = Number(process.env.ANALYTICS_DECIDE_RPM) || 2400;
/** Pedidos por minuto de una IP a un proyecto (debajo del tope del proyecto). */
const IP_PROJECT_RPM = Number(process.env.ANALYTICS_IP_RPM) || 300;
/** Pedidos por minuto de una IP antes de mirar la key (por instancia, sin ir a la base). */
const IP_PRECHECK_RPM = Number(process.env.ANALYTICS_IP_PRECHECK_RPM) || 600;

const ipWindows = new Map<string, { start: number; count: number }>();

/** Tope por IP en memoria, antes de buscar la key: frena a quien prueba keys o inunda sin costar un viaje a la base. */
function ipPrecheck(ip: string): boolean {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
  const now = Date.now();
  const w = ipWindows.get(ip);
  if (!w || now - w.start >= 60_000) {
    if (ipWindows.size > 10_000) ipWindows.clear();
    ipWindows.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= IP_PRECHECK_RPM;
}

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

export function reply(req: Request, status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Lee el cuerpo y corta apenas pasa el tope, aunque venga sin content-length. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** Cuerpo con tope de tamaño. Los SDKs de servidor mandan gzip: el tope vale para lo descomprimido también. */
async function readBody(req: Request): Promise<string | null> {
  const raw = await readCapped(req, INGEST_LIMITS.maxBodyBytes).catch(() => null);
  if (raw === null) return null;
  const gzipped = /gzip/i.test(req.headers.get('content-encoding') ?? '') || /gzip/i.test(new URL(req.url).searchParams.get('compression') ?? '');
  const buffer = Buffer.from(raw);
  if (gzipped) {
    try {
      return gunzipSync(buffer, { maxOutputLength: INGEST_LIMITS.maxBodyBytes }).toString('utf8');
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return null;
    }
  }
  return buffer.toString('utf8');
}

type Resolved = { project: ProjectRow; secret: boolean } | { res: NextResponse };

/**
 * Proyecto del pedido: key secreta (Authorization: Bearer zss_…, para
 * servidores: sin chequeo de origen) o key pública del cuerpo (con la lista de
 * dominios permitidos y Do Not Track).
 */
export async function resolveProject(req: Request, bodyKey: string | null): Promise<Resolved> {
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

export function dntOn(req: Request): boolean {
  return req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1';
}

/**
 * Tope por proyecto y por IP dentro del proyecto, los dos en un solo viaje a la
 * base (ventanas fijas de un minuto en rate_limits, como lib/rate-limit.ts).
 */
export async function limited(req: Request, bucket: string, projectId: string, rpm: number): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  const now = Date.now();
  const start = Math.floor(now / 60_000) * 60_000;
  const upsert = (key: string) => ({
    sql: `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
          ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
    args: [key, start, start + 60_000],
  });
  await ensureMigrated();
  const [project, ip] = await getClient().batch([upsert(`${bucket}:${projectId}`), upsert(`${bucket}:${projectId}:${clientIp(req)}`)], 'write');
  if (Number(project.rows[0]?.count ?? 0) <= rpm && Number(ip.rows[0]?.count ?? 0) <= Math.min(rpm, IP_PROJECT_RPM)) return null;
  const res = reply(req, 429, { error: 'rate_limited' });
  res.headers.set('retry-after', String(Math.max(1, Math.ceil((start + 60_000 - now) / 1000))));
  return res;
}

export function precheck(req: Request): NextResponse | null {
  return ipPrecheck(clientIp(req)) ? null : reply(req, 429, { error: 'rate_limited' });
}

export async function handleCapture(req: Request): Promise<Response> {
  const pre = precheck(req);
  if (pre) return pre;
  const text = await readBody(req);
  if (text === null) return reply(req, 413, { error: 'payload_too_large' });
  const parsed = parseIngestBody(text);
  if (!parsed.ok) return reply(req, 400, { error: parsed.error });
  const r = await resolveProject(req, parsed.apiKey);
  if ('res' in r) return r.res;
  // Bots conocidos: lo que manda un crawler desde el navegador no se guarda, salvo que el proyecto pida lo contrario.
  if (!r.secret && r.project.keep_bots !== 1 && isBotUserAgent(req.headers.get('user-agent'))) {
    const blocked = await limited(req, 'aingest', r.project.id, INGEST_RPM);
    if (blocked) return blocked;
    await getDb().prepare('UPDATE analytics_projects SET bots_filtered = bots_filtered + ? WHERE id = ?').run(parsed.events.length, r.project.id);
    return reply(req, 200, { status: 1, stored: 0, dropped: parsed.events.length, reason: 'bot' });
  }
  // Do Not Track / GPC del navegador: con el ajuste prendido no se guarda nada.
  if (!r.secret && r.project.respect_dnt === 1 && dntOn(req)) return reply(req, 200, { status: 1, stored: 0, dropped: parsed.events.length, reason: 'dnt' });
  const block = await limited(req, 'aingest', r.project.id, INGEST_RPM);
  if (block) return block;
  // Un servidor con la key secreta no es el navegador de la persona: sin user agent ni IP del pedido.
  const ctx = r.secret ? null : requestContext(req);
  // Sin cookies: el id sale de un hash del lado del servidor, solo si el proyecto lo prendió. La IP no se guarda.
  let events = parsed.events;
  let storeCtx = ctx;
  if (events.some((e) => isCookielessId(e.distinctId))) {
    if (r.secret || r.project.cookieless !== 1) events = events.filter((e) => !isCookielessId(e.distinctId));
    else {
      events = await applyCookieless(r.project, events, req, clientIp(req));
      if (storeCtx) storeCtx = { ...storeCtx, ip: null };
    }
  }
  // Tope diario de los eventos especiales (errores, encuestas, vitals, LLM).
  const stored = await storeEvents(r.project, await capSpecialEvents(r.project.id, events), storeCtx);
  return reply(req, 200, { status: 1, stored, dropped: parsed.dropped + (parsed.events.length - stored) });
}

export async function handleDecide(req: Request): Promise<Response> {
  const pre = precheck(req);
  if (pre) return pre;
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
  let distinctId = typeof body.distinct_id === 'string' ? body.distinct_id.slice(0, INGEST_LIMITS.maxDistinctId) : '';
  // Sin cookies, el flag se evalúa con el id de hoy (y sin el ajuste, nada: no hay a quién evaluar).
  if (isCookielessId(distinctId)) distinctId = r.project.cookieless === 1 && !r.secret ? await cookielessIdFor(r.project, req, clientIp(req), Date.now()) : '';
  const overrides = body.person_properties && typeof body.person_properties === 'object' && !Array.isArray(body.person_properties) ? (body.person_properties as Record<string, unknown>) : {};
  const botHere = !r.secret && r.project.keep_bots !== 1 && isBotUserAgent(req.headers.get('user-agent'));
  const { flags: featureFlags, payloads } = distinctId ? await decideFlagsFull(r.project.id, distinctId, overrides) : { flags: {}, payloads: {} };
  return reply(req, 200, {
    featureFlags,
    featureFlagPayloads: payloads,
    config: {
      autocapture: r.project.autocapture === 1,
      respectDnt: r.project.respect_dnt === 1,
      // Replay y heatmaps: solo si un admin los prendió; con Do Not Track y el ajuste prendido, nunca.
      ...replayConfig(r.project, (!r.secret && r.project.respect_dnt === 1 && dntOn(req)) || botHere),
      captureExceptions: !botHere && r.project.capture_exceptions === 1,
      webVitals: !botHere && r.project.web_vitals === 1,
      // Sin encuestas al aire el snippet no hace ningún pedido más.
      surveys: botHere ? false : await hasLivePopover(r.project.id),
    },
  });
}

/**
 * Definiciones de los flags para evaluar en tu servidor sin ir a la red en cada
 * chequeo. Solo con la key secreta: incluye las condiciones de segmentación.
 */
export async function handleFlagDefinitions(req: Request): Promise<Response> {
  const pre = precheck(req);
  if (pre) return pre;
  const bearer = extractBearer(req);
  if (!bearer?.startsWith('zss_')) return reply(req, 401, { error: 'secret_key_required' });
  const project = await projectByKey(bearer, 'secret');
  if (!project) return reply(req, 401, { error: 'invalid_key' });
  const block = await limited(req, 'adefs', project.id, 120);
  if (block) return block;
  const flags = await projectFlags(project.id);
  return reply(req, 200, { flags, hash: 'sha1(key.distinct_id) first 15 hex / 0xfffffffffffffff; variants add the salt "variant"' });
}

/**
 * /flags de los SDKs de PostHog: además de featureFlags, el mapa `flags` con la
 * forma que espera la versión 2 de su protocolo.
 */
export async function handleSdkFlags(req: Request): Promise<Response> {
  const res = await handleDecide(req);
  if (res.status !== 200) return res;
  const body = (await res.json()) as { featureFlags: Record<string, boolean | string>; featureFlagPayloads: Record<string, unknown>; config: unknown };
  const flags: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.featureFlags)) {
    const payload = body.featureFlagPayloads[key];
    flags[key] = {
      key,
      enabled: value !== false,
      variant: typeof value === 'string' ? value : null,
      reason: { code: value === false ? 'no_condition_match' : 'condition_match', description: '' },
      metadata: { id: 0, version: 1, payload: payload === undefined ? null : JSON.stringify(payload) },
    };
  }
  return reply(req, 200, { ...body, flags, errorsWhileComputingFlags: false, requestId: '' });
}

/** Encuestas al aire para un distinct_id (el snippet las pide solo si /decide dijo que hay). */
export async function handleSurveys(req: Request): Promise<Response> {
  const pre = precheck(req);
  if (pre) return pre;
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
  const block = await limited(req, 'asurveys', r.project.id, DECIDE_RPM);
  if (block) return block;
  const distinctId = typeof body.distinct_id === 'string' ? body.distinct_id.slice(0, INGEST_LIMITS.maxDistinctId) : '';
  return reply(req, 200, { surveys: await surveysFor(r.project.id, distinctId) });
}

/** Borra la persona de un distinct_id con todos sus eventos. Solo con la key secreta. */
export async function handleDeletePerson(req: Request): Promise<Response> {
  const pre = precheck(req);
  if (pre) return pre;
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
