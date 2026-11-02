/**
 * Errores, la parte pura: normaliza un $exception y calcula su huella en el
 * servidor. Lo que mande el cliente como huella se ignora siempre. Los cuadros
 * del stack quedan como lista { file, function, line, column } con topes.
 */
import { createHash } from 'crypto';
import type { StackFrame } from './more-types';
import { cleanUrl } from './ingest-core';

export const ERROR_LIMITS = { type: 200, message: 1000, frames: 30, file: 300, fn: 200 } as const;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n < 1e9 ? n : null;
}

/** Stack en texto (Chrome, Firefox o Safari) → cuadros. */
export function parseStack(stack: string): StackFrame[] {
  const out: StackFrame[] = [];
  for (const raw of stack.slice(0, 20_000).split('\n')) {
    if (out.length >= ERROR_LIMITS.frames) break;
    const line = raw.trim();
    const m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line) ?? /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
    if (!m) continue;
    out.push({ function: (m[1] ?? '').slice(0, ERROR_LIMITS.fn), file: m[2].slice(0, ERROR_LIMITS.file), line: int(m[3]), column: int(m[4]) });
  }
  return out;
}

/** Cuadros que mandó el cliente (lista o texto) → validados. Nunca confía en la forma. */
export function cleanFrames(raw: unknown): StackFrame[] {
  if (typeof raw === 'string') return parseStack(raw);
  if (!Array.isArray(raw)) return [];
  const out: StackFrame[] = [];
  for (const f of raw) {
    if (out.length >= ERROR_LIMITS.frames) break;
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
    const r = f as Record<string, unknown>;
    const file = text(r.file ?? r.filename, ERROR_LIMITS.file);
    const fn = text(r.function, ERROR_LIMITS.fn);
    if (!file && !fn) continue;
    out.push({ file, function: fn, line: int(r.line ?? r.lineno), column: int(r.column ?? r.colno) });
  }
  return out;
}

/** Quita lo que cambia en cada aparición del mismo error: URLs, ids y números. */
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/\b[0-9a-f]{12,}\b/g, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Archivo sin origen, query ni hash de build: /assets/app.3f2a9c1b.js y /assets/app.9d81e0aa.js son el mismo. */
export function normalizeFile(file: string): string {
  const path = file.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0];
  return path.replace(/[.-][0-9a-f]{6,}(?=\.[a-z0-9]+$)/i, '');
}

/** Huella (hex de 32): tipo, mensaje normalizado y hasta 5 cuadros, sin líneas (cambian con cada build). */
export function exceptionFingerprint(type: string, message: string, frames: StackFrame[]): string {
  const parts = [type.toLowerCase(), normalizeMessage(message), ...frames.slice(0, 5).map((f) => `${normalizeFile(f.file)}:${f.function}`)];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

/**
 * $exception → propiedades guardadas. Acepta $exception_type, _message y
 * _stack, o $exception_list como lo manda posthog-js (ahí el cuadro más
 * reciente va último). Pisa $exception_fingerprint con la del servidor.
 */
/** Un mensaje de error suele traer URLs firmadas, emails o números largos: mismo criterio que las propiedades de los eventos. */
export function scrubMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>)]+/gi, (url) => cleanUrl(url) ?? '[url]')
    .replace(/[^\s"'<>@]+@[^\s"'<>@]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(?:bearer|token|api[_-]?key|password|secret)[=:\s]+\S+/gi, (m) => `${m.split(/[=:\s]/)[0]}=[redacted]`)
    .replace(/\d[\d -]{8,}\d/g, '[number]');
}

export function normalizeExceptionProps(props: Record<string, unknown>): void {
  const list = Array.isArray(props.$exception_list) ? props.$exception_list : null;
  const first = list && list[0] && typeof list[0] === 'object' ? (list[0] as Record<string, unknown>) : null;
  const type = text(props.$exception_type, ERROR_LIMITS.type) || text(first?.type, ERROR_LIMITS.type) || 'Error';
  const message = scrubMessage(text(props.$exception_message, ERROR_LIMITS.message) || text(first?.value, ERROR_LIMITS.message));
  let frames = cleanFrames(props.$exception_stack);
  if (!frames.length && first) {
    const st = first.stacktrace && typeof first.stacktrace === 'object' ? (first.stacktrace as Record<string, unknown>) : null;
    frames = cleanFrames(Array.isArray(st?.frames) ? [...(st.frames as unknown[])].reverse() : []);
  }
  props.$exception_type = type;
  props.$exception_message = message;
  props.$exception_stack = frames;
  props.$exception_fingerprint = exceptionFingerprint(type, message, frames);
  delete props.$exception_list;
}
