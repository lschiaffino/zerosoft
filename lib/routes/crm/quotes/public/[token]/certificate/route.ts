import { NextRequest, NextResponse } from 'next/server';
import { getDb, type CrmQuoteRow } from '@/lib/db';
import { getQuoteSignature, signatureCertificate } from '@/lib/crm-quote-sign';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Certificado de firma (PDF) para quien firmó: mismo token que la página pública. */
export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limited = await limitByIp(req, 'crm:quote-cert', 30, 600);
  if (limited) return limited;
  if (!token || token.length > 100) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const q = (await getDb().prepare("SELECT * FROM crm_quotes WHERE token = ? AND status = 'accepted'").get(token)) as
    | CrmQuoteRow
    | undefined;
  const sig = q ? await getQuoteSignature(q.id) : null;
  if (!q || !sig) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const base = (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, '');
  const pdf = signatureCertificate(q, sig, `${base}/en/q/${token}`);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="signature-${q.number.replace(/[^\w-]/g, '_')}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
