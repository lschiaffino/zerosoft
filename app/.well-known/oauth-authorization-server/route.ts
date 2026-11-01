import { authorizationServerMetadata, corsPreflight, publicJson } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 8414. */
export async function GET() {
  return publicJson(authorizationServerMetadata());
}

export async function OPTIONS() {
  return corsPreflight();
}
