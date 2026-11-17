import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Antes firmaba la subida directa del zip de un import a Blob, que quedaba
 * pública. Ahora el zip sube directo y privado por /api/files/upload
 * (lib/files/direct-upload.ts, propósito 'import-zip'). 501: una pestaña vieja
 * sube por partes.
 */
export async function POST(_req: Request) {
  return NextResponse.json({ error: 'client_upload_unavailable' }, { status: 501, headers: { 'Cache-Control': 'no-store' } });
}
