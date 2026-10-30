import { NextRequest } from 'next/server';
import { handle, must, need } from '@/lib/books-http';
import { NextResponse } from 'next/server';
import { attachReceipt, readReceipt } from '@/lib/books-purchasing';
import { BooksError } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: el comprobante (privado: pasa por acá con sesión y rol). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'expenses.read');
    const file = must(await readReceipt(actor.ws, (await params).id));
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.mime,
        'content-disposition': `inline; filename="${file.name.replace(/[^\w.-]+/g, '_')}"`,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        'x-robots-tag': 'noindex',
      },
    });
  });
}

/** POST (multipart "file"): sube o reemplaza el comprobante; entra solo si sus bytes son JPEG, PNG, WebP o PDF. */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new BooksError('file_required');
    if (file.size > 10 * 1024 * 1024) throw new BooksError('file_too_large', 413);
    return { expense: await attachReceipt(actor, (await params).id, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }) };
  });
}
