import { corsPreflight, protectedResourceMetadata, publicJson } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 9728. */
export async function GET() {
  return publicJson(protectedResourceMetadata());
}

export async function OPTIONS() {
  return corsPreflight();
}
