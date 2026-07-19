/**
 * Docs — helpers compartidos por las rutas API.
 */
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

export function docsError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export function invalidBody(error: ZodError): NextResponse {
  const issue = error.issues[0];
  const code = issue?.message === 'invalid_email' ? 'invalid_email' : 'invalid_input';
  return docsError(400, code);
}
