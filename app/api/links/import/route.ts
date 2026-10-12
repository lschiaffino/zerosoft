import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';
import { fetchBitlyLinks, importLinks, itemsFromCsv } from '@/lib/bitly-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Importa links: JSON { source: 'bitly', token } (API de Bitly) o multipart con
 * un archivo CSV (export de Bitly u otro acortador). Devuelve un reporte.
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'links-import', 5, 600);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let items;
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: 'empty' }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    items = itemsFromCsv(await file.text());
    if (items.length === 0) return NextResponse.json({ error: 'csv_no_url_column' }, { status: 400 });
  } else {
    const body = (await req.json().catch(() => null)) as { source?: string; token?: string } | null;
    if (body?.source !== 'bitly' || !body.token?.trim()) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    try {
      items = await fetchBitlyLinks(body.token.trim());
    } catch (err) {
      const code = err instanceof Error && err.message.startsWith('bitly_') ? err.message : 'bitly_error';
      return NextResponse.json({ error: code }, { status: 400 });
    }
  }

  const report = await importLinks(user.id, items);
  return NextResponse.json(report);
}
