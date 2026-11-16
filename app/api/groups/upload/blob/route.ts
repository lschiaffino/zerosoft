import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Antes firmaba subidas directas a Blob que quedaban públicas. Ahora la
 * subida directa es privada y pasa por /api/files/upload
 * (lib/files/direct-upload.ts). 501: una pestaña vieja cae a la subida por el
 * servidor de su app.
 */
export async function POST(_req: Request) {
  return NextResponse.json({ error: 'client_upload_unavailable' }, { status: 501, headers: { 'Cache-Control': 'no-store' } });
}
