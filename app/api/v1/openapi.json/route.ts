import { NextResponse } from 'next/server';
import { buildOpenApiSpec } from '@/lib/openapi';

export const dynamic = 'force-static';

/** Spec OpenAPI pública (sin auth) para Postman, Insomnia o generar clientes. */
export function GET() {
  return NextResponse.json(buildOpenApiSpec(), {
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' },
  });
}
