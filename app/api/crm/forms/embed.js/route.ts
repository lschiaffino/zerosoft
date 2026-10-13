import { NextResponse } from 'next/server';
import { FORM_EMBED_SCRIPT } from '@/lib/crm-forms-embed';

export const dynamic = 'force-static';

/** Script de embed de formularios del CRM (ver lib/crm-forms-embed.ts). */
export function GET() {
  return new NextResponse(FORM_EMBED_SCRIPT, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
