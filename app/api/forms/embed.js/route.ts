import { NextResponse } from 'next/server';
import { FORM_EMBED_SCRIPT } from '@/lib/form-engine-embed';

export const dynamic = 'force-static';

/** Script de embed (iframe en línea o popup) de Forms. El mismo que el del CRM: ver lib/form-engine-embed.ts. */
export function GET() {
  return new NextResponse(FORM_EMBED_SCRIPT, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
