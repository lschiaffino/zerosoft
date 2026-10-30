import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { updateSettings } from '@/lib/books';
import { BooksError } from '@/lib/books-schema';
import { sniffReceipt } from '@/lib/books-purchasing';
import { saveUpload } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/books/settings/logo (multipart "file"): logo JPEG o PNG para el PDF, el email y la factura pública. */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new BooksError('file_required');
    if (file.size > 2 * 1024 * 1024) throw new BooksError('file_too_large', 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = sniffReceipt(bytes);
    if (mime !== 'image/png' && mime !== 'image/jpeg') throw new BooksError('file_type_not_allowed', 415);
    // El logo es público por diseño (va en el email y en la factura pública).
    const url = await saveUpload('workspace', mime === 'image/png' ? 'books-logo.png' : 'books-logo.jpg', mime, bytes);
    return { settings: await updateSettings(actor, { logoUrl: url }) };
  });
}
