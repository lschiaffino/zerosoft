import { NextRequest } from 'next/server';
import { booksFail, booksJson, readJson } from '@/lib/books-http';
import { BooksError } from '@/lib/books-schema';
import { decideQuote } from '@/lib/books-quotes';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/** El cliente acepta o rechaza un presupuesto desde el link, sin login. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const limited = await limitByIp(req, 'books-quote-decide', 20, 3600);
  if (limited) return limited;
  try {
    const { token } = await params;
    const b = await readJson(req);
    if (b.decision !== 'accepted' && b.decision !== 'declined') throw new BooksError('invalid_input');
    const q = await decideQuote(token, b.decision, String(b.name ?? ''));
    return booksJson({ status: q.status });
  } catch (err) {
    return booksFail(err);
  }
}
