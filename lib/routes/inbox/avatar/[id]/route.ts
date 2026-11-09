import { NextResponse } from 'next/server';
import { withOwner } from '@/lib/inbox/http';
import { avatarFor } from '@/lib/inbox/wa-meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Foto de perfil de un chat de WhatsApp de la persona. Se baja del servidor
 * de WhatsApp con la sesión y queda en la caché privada del navegador (el
 * link cambia con ?v= cuando cambia la foto).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const img = await avatarFor(owner, id);
    return new NextResponse(new Uint8Array(img.data), {
      headers: {
        'content-type': img.mime,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'referrer-policy': 'no-referrer',
      },
    });
  });
}
