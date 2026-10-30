import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { importStatement } from '@/lib/books-bank';
import { BooksError } from '@/lib/books-schema';
import { AMOUNT_FORMATS, type AmountFormat } from '@/lib/books-money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST (multipart "file", CSV u OFX; o JSON { filename, text }): importa el extracto sin duplicar líneas. */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    let filename = 'statement.csv';
    let text = '';
    let dayFirst = true;
    let format = 'auto';
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!file || typeof file === 'string') throw new BooksError('file_required');
      if (file.size > 5 * 1024 * 1024) throw new BooksError('file_too_large', 413);
      filename = file.name;
      text = await file.text();
      dayFirst = form?.get('dayFirst') !== '0';
      format = String(form?.get('format') ?? 'auto');
    } else {
      const b = await readJson(req);
      filename = String(b.filename ?? filename);
      text = String(b.text ?? '');
      dayFirst = b.dayFirst !== false;
      format = String(b.format ?? 'auto');
    }
    if (!text.trim()) throw new BooksError('file_required');
    const amountFormat: AmountFormat = (AMOUNT_FORMATS as readonly string[]).includes(format) ? (format as AmountFormat) : 'auto';
    return importStatement(actor, (await params).id, { filename, text, dayFirst, amountFormat });
  });
}
