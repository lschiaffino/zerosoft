import { NextRequest, NextResponse } from 'next/server';
import { documentFileUrl } from '@/lib/crm-media';
import { servePdf } from '@/lib/crm-media-file';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PDF de un link de seguimiento, servido desde nuestro dominio (el visor lo lee con pdf.js). */
export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limited = await limitByIp(req, 'crm:doc-file', 60, 600);
  if (limited) return limited;
  const file = await documentFileUrl(token);
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return servePdf(req, file.url, file.name);
}
