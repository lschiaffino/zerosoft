import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canReadFile, getFileRow, readDesignFile } from '@/lib/design';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Una imagen de Design: para alguien del workspace con Design, o con ?t=<token>
 * del link público de un diseño que la usa. Mismo origen (exportar a PNG en el
 * navegador no se "ensucia" con imágenes de otro dominio).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const file = await getFileRow(id);
  if (!file) return new Response(null, { status: 404 });
  const token = req.nextUrl.searchParams.get('t');
  const user = await getCurrentUser();
  if (!(await canReadFile(file, { ws: user?.id ?? null, token }))) return new Response(null, { status: 404 });
  const bytes = await readDesignFile(file);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // El archivo no cambia (cada subida es un id nuevo); el permiso se chequea en cada request.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
