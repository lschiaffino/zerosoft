/**
 * Rutas de /api/bi: quién llama y errores en { error: '<code>' }.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { AiError } from '../ai';
import { biActor, biError, isResponse, readJson, type BiViewer } from './access';
import { RunError } from './run';
import { BiStoreError } from './store';

export function toResponse(err: unknown): NextResponse {
  if (err instanceof BiStoreError) return biError(err.status, err.code);
  if (err instanceof RunError) return biError(err.status, err.code, err.detail ? { detail: err.detail } : {});
  if (err instanceof ZodError) return biError(400, 'invalid_input', { issues: err.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) });
  if (err instanceof AiError) return biError(err.code === 'ai_disabled' ? 503 : 429, err.code);
  // eslint-disable-next-line no-console
  console.error('[bi]', err);
  return biError(500, 'internal_error');
}

type Handler = (viewer: BiViewer, body: Record<string, unknown>) => Promise<unknown>;

/** Corre el handler con el actor; el resultado va como JSON (status 200 o el que diga). */
export async function withViewer(req: NextRequest | Request, need: 'read' | 'write', fn: Handler, status = 200): Promise<Response> {
  const viewer = await biActor(req, need);
  if (isResponse(viewer)) return viewer;
  let body: Record<string, unknown> = {};
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    const parsed = await readJson(req);
    if (!parsed) return biError(400, 'invalid_json');
    body = parsed;
  }
  try {
    const out = await fn(viewer, body);
    return NextResponse.json(out ?? { ok: true }, { status });
  } catch (err) {
    return toResponse(err);
  }
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Valores de variables o filtros: solo strings. */
export function values(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
      if (typeof val === 'string' && val.length <= 500) out[k] = val;
      else if (typeof val === 'number' && Number.isFinite(val)) out[k] = String(val);
    }
  }
  return out;
}
