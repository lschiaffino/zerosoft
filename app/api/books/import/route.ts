import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { BooksError } from '@/lib/books-schema';
import { importContactsCsv, importItemsCsv, MAX_IMPORT_BYTES } from '@/lib/books-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** FormData: kind=contacts|items, file=CSV. */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) throw new BooksError('file_required');
    if (file.size > MAX_IMPORT_BYTES) throw new BooksError('file_too_large', 413);
    const text = await file.text();
    return form.get('kind') === 'items' ? importItemsCsv(actor, text) : importContactsCsv(actor, text);
  });
}
