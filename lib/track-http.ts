/**
 * Track — helpers compartidos por las rutas API.
 */
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export function trackError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export function zodErrorCode(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid_input';
  if (issue.message === 'invalid_slug') return 'invalid_slug';
  if (issue.message === 'invalid_date') return 'invalid_date';
  const field = String(issue.path[0] ?? '');
  if (
    field === 'name' &&
    ((issue.code === 'invalid_type' && issue.received === 'undefined') || issue.code === 'too_small')
  ) {
    return 'missing_name';
  }
  if (field === 'title' && issue.code === 'too_small') {
    return 'missing_title';
  }
  return 'invalid_input';
}

export function invalidBody(error: ZodError): NextResponse {
  return trackError(400, zodErrorCode(error));
}

export function pageParams(sp: URLSearchParams): { page: number; pageSize: number } {
  const pageSize = Math.min(Math.max(Number(sp.get('pageSize') ?? '25') || 25, 1), 100);
  const page = Math.max(Number(sp.get('page') ?? '1') || 1, 1);
  return { page, pageSize };
}

export function sortParam<T extends string>(
  sp: URLSearchParams,
  allowed: readonly T[],
): T | undefined {
  const v = sp.get('sort');
  return allowed.includes(v as T) ? (v as T) : undefined;
}

export function stringArrayParam(sp: URLSearchParams, name: string): string[] | undefined {
  const all = sp.getAll(name);
  if (all.length > 0) {
    const out = all.flatMap((v) => v.split(',').map((s) => s.trim()).filter(Boolean));
    return out.length ? out : undefined;
  }
  const single = sp.get(name);
  if (!single) return undefined;
  const out = single
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}
