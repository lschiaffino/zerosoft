import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listEmailTemplates } from '@/lib/crm-email';
import { cleanRow } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const kind = req.nextUrl.searchParams.get('kind');
  const templates = await listEmailTemplates(auth.user.id, kind === 'template' || kind === 'snippet' ? kind : undefined);
  return NextResponse.json({ templates: templates.map(cleanRow) });
}
