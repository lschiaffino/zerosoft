import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeQuote, sessionScope } from '@/lib/crm-visibility';
import { getQuote } from '@/lib/crm-products';
import { getQuoteSignature, signatureCertificate } from '@/lib/crm-quote-sign';
import { notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Certificado de firma (PDF) desde la app. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeQuote(user.id, id, await sessionScope(user)))) return notFound();
  const quote = await getQuote(user.id, id);
  const sig = quote ? await getQuoteSignature(quote.id) : null;
  if (!quote || !sig) return notFound();
  const base = (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, '');
  const pdf = signatureCertificate(quote, sig, `${base}/en/q/${quote.token}`);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="signature-${quote.number.replace(/[^\w-]/g, '_')}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
