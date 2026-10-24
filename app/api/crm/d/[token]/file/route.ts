import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { documentFileUrl } from '@/lib/crm-media';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PDF de un link de seguimiento, servido desde nuestro dominio (el visor lo lee con pdf.js). */
export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limited = await limitByIp(req, 'crm:doc-file', 60, 600);
  if (limited) return limited;
  const file = await documentFileUrl(token);
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let body: Buffer;
  if (file.url.startsWith('/uploads/')) {
    const root = path.join(process.cwd(), 'public', 'uploads');
    const full = path.join(process.cwd(), 'public', file.url);
    if (!full.startsWith(root + path.sep)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    body = await readFile(full).catch(() => Buffer.alloc(0));
  } else {
    // La URL sale de la base y solo puede ser de nuestro Blob (lib/crm-media isOwnUploadUrl).
    const res = await fetch(file.url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    body = Buffer.from(await res.arrayBuffer());
  }
  if (!body.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const safeName = file.name.replace(/[^\w .-]/g, '_').slice(0, 120) || 'document';
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${safeName}.pdf"`,
      'cache-control': 'private, max-age=300',
      'x-robots-tag': 'noindex',
    },
  });
}
