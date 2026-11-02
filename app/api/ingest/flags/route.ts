import { handleSdkFlags, preflight } from '@/lib/analytics/ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La ruta de flags de los SDKs de PostHog (formato v2). */
export async function POST(req: Request) {
  return handleSdkFlags(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
