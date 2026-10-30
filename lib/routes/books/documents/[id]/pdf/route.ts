import { NextRequest } from 'next/server';
import { handle, must, need } from '@/lib/books-http';
import { NextResponse } from 'next/server';
import { docArea, getDocument } from '@/lib/books-docs';
import { documentPdf } from '@/lib/books-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/books/documents/<id>/pdf?locale=: PDF del documento (inline). */
export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const doc = must(await getDocument(actor.ws, (await params).id));
    need(actor, `${docArea(doc.docType)}.read`);
    const pdf = await documentPdf(actor.ws, doc, req.nextUrl.searchParams.get('locale') ?? 'en');
    const name = (doc.numberLabel || doc.reference || doc.id).replace(/[^\w.-]+/g, '_');
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}.pdf"`, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    });
  });
}
