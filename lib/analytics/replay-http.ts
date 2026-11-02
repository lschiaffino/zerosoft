/**
 * /api/ingest/replay: chunks de rrweb del snippet. Público, con las mismas
 * protecciones que la ingesta de eventos (CORS, dominios permitidos, Do Not
 * Track, topes por proyecto y por IP) y además: replay prendido en el proyecto,
 * cuerpo e inflado con tope, forma de los eventos validada y cupos por sesión y
 * por día. La key va en la URL porque el cuerpo puede venir comprimido y se mira
 * antes de gastar en inflar. text/plain: sin preflight CORS.
 */
import { promisify } from 'util';
import { gunzip } from 'zlib';
import { parseChunk, REPLAY_LIMITS, sampledIn } from './replay-core';
import { storeChunk } from './replay';
import { isBotUserAgent } from './bots';
import { dntOn, limited, precheck, readCapped, reply, resolveProject } from './ingest-http';

const gunzipAsync = promisify(gunzip);
const REPLAY_RPM = Number(process.env.ANALYTICS_REPLAY_RPM) || 3000;

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

function secondsToUtcMidnight(now: number): number {
  const d = new Date(now);
  return Math.max(60, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000));
}

export async function handleReplayIngest(req: Request): Promise<Response> {
  const pre = precheck(req);
  if (pre) return pre;
  const body = await readCapped(req, REPLAY_LIMITS.maxBodyBytes).catch(() => null);
  if (body === null) return reply(req, 413, { error: 'payload_too_large' });

  const key = new URL(req.url).searchParams.get('k');
  const r = await resolveProject(req, key);
  if ('res' in r) return r.res;
  // Apagado (o se apagó hace poco): el snippet deja de mandar con este estado.
  if (r.project.replay_enabled !== 1) return reply(req, 403, { error: 'replay_disabled' });
  if (!r.secret && r.project.respect_dnt === 1 && dntOn(req)) return reply(req, 200, { status: 1, stored: 0, reason: 'dnt' });
  if (!r.secret && r.project.keep_bots !== 1 && isBotUserAgent(req.headers.get('user-agent'))) return reply(req, 200, { status: 1, stored: 0, reason: 'bot' });
  const block = await limited(req, 'areplay', r.project.id, REPLAY_RPM);
  if (block) return block;

  let text: string;
  try {
    text = isGzip(body)
      ? (await gunzipAsync(body, { maxOutputLength: REPLAY_LIMITS.maxInflatedBytes })).toString('utf8')
      : Buffer.from(body).toString('utf8');
  } catch (err) {
    // zlib corta al pasar maxOutputLength: es una bomba o un chunk demasiado grande.
    const tooBig = (err as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE';
    return reply(req, tooBig ? 413 : 400, { error: tooBig ? 'payload_too_large' : 'invalid_gzip' });
  }

  let parsed;
  try {
    parsed = parseChunk(JSON.parse(text));
  } catch {
    return reply(req, 400, { error: 'invalid_json' });
  }
  if (!parsed.ok) return reply(req, parsed.error === 'too_many_events' ? 413 : 400, { error: parsed.error });

  // La muestra la decide la sesión, con la misma cuenta que el snippet.
  if (!sampledIn(parsed.chunk.sessionId, r.project.replay_sample_rate)) return reply(req, 200, { status: 1, stored: 0, reason: 'sampled_out' });

  let res;
  try {
    res = await storeChunk(r.project, parsed.chunk, parsed.summary);
  } catch (err) {
    // JSON.stringify de un evento absurdamente anidado: no es un chunk de rrweb.
    if (err instanceof RangeError) return reply(req, 400, { error: 'invalid_events' });
    throw err;
  }
  if (res.status === 'rejected') {
    const out = reply(req, res.http, { error: res.error });
    if (res.http === 429) out.headers.set('retry-after', String(secondsToUtcMidnight(Date.now())));
    return out;
  }
  return reply(req, 200, { status: 1, stored: res.status === 'stored' ? 1 : 0, duplicate: res.status === 'duplicate' });
}
