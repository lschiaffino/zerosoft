import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDocument, getPublicDocRow } from '@/lib/books-docs';
import { documentPdf } from '@/lib/books-pdf';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/** GET /api/books/public/<token>/pdf: el PDF de la factura pública (link vigente). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const limited = await limitByIp(req, 'books:pdf', 60, 600);
  if (limited) return limited;
  const row = await getPublicDocRow((await params).token);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const doc = (await getDocument(row.workspace_id, row.id))!;
  const pdf = await documentPdf(row.workspace_id, doc, req.nextUrl.searchParams.get('locale') ?? 'en');
  const name = (doc.numberLabel || doc.id).replace(/[^\w.-]+/g, '_');
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}.pdf"`, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' },
  });
}
