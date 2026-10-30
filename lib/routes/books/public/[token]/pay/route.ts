import { NextRequest } from 'next/server';
import { booksFail, booksJson, readJson } from '@/lib/books-http';
import { startInvoicePayment } from '@/lib/books-payments';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/** POST /api/books/public/<token>/pay { method, locale }: abre el cobro del saldo (sin sesión, con límite por IP). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const limited = await limitByIp(req, 'books:pay', 20, 600);
  if (limited) return limited;
  const b = await readJson(req);
  try {
    const url = await startInvoicePayment((await params).token, b.method === 'mercadopago' ? 'mercadopago' : 'stripe', String(b.locale ?? 'en'));
    return booksJson({ url });
  } catch (err) {
    return booksFail(err);
  }
}
