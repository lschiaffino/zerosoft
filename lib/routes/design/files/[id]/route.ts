import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canReadFile, getFileRow, readDesignFile } from '@/lib/design';
import { designActorOf } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Una imagen de Design: para quien la subió o ve un diseño que la usa (y los
 * logos del kit, para el workspace), o con ?t=<token> del link público de un
 * diseño que la usa. Mismo origen (exportar a PNG en el
 * navegador no se "ensucia" con imágenes de otro dominio).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const file = await getFileRow(id);
  if (!file) return new Response(null, { status: 404 });
  const token = req.nextUrl.searchParams.get('t');
  const user = await getCurrentUser();
  if (!(await canReadFile(file, { actor: user ? designActorOf(user) : null, token }))) return new Response(null, { status: 404 });
  const bytes = await readDesignFile(file);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // El archivo no cambia (cada subida es un id nuevo), pero el permiso sí
      // (dejar de compartir, cortar el link): caché corta y privada.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
