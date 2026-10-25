import { NextRequest } from 'next/server';
import { getDocument } from '@/lib/crm-media';
import { mediaUser } from '@/lib/crm-media-http';
import { servePdf } from '@/lib/crm-media-file';
import { notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PDF del documento ("Open PDF" en el CRM). */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const doc = await getDocument(u.user.id, id);
  if (!doc) return notFound();
  return servePdf(req, doc.url, doc.name);
}
