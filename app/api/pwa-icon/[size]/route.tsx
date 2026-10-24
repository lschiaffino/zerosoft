import { ImageResponse } from 'next/og';
import { ZERO_PATH, ZERO_VIEWBOX } from '@/lib/zero-mark';

export const runtime = 'nodejs';

const SIZES = new Set([192, 512]);

/**
 * Íconos de la app instalable (app/manifest.ts): el cero de la marca, blanco
 * sobre tinta, a sangre y con el trazo dentro de la zona segura de los
 * íconos "maskable" (el 60% central), así sirve también recortado en círculo.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size: raw } = await ctx.params;
  const size = Number(raw);
  if (!SIZES.has(size)) return new Response('not_found', { status: 404 });
  const h = Math.round(size * 0.5);
  const w = Math.round((h * 20) / 24);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d0d0d',
        }}
      >
        <svg width={w} height={h} viewBox={ZERO_VIEWBOX}>
          <path d={ZERO_PATH} fill="#ffffff" fillRule="evenodd" />
        </svg>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { 'cache-control': 'public, max-age=86400, immutable' },
    },
  );
}
