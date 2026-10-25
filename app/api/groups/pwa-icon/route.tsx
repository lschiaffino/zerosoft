import { ImageResponse } from 'next/og';
import { ZERO_PATH, ZERO_VIEWBOX } from '@/lib/zero-mark';

export const runtime = 'nodejs';

/**
 * Íconos de la app instalable de Groups (?size=192|512, &maskable=1 deja
 * margen para el recorte del sistema). El cero de la marca sobre tinta.
 */
export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const size = p.get('size') === '512' ? 512 : 192;
  const pad = p.get('maskable') === '1' ? 0.3 : 0.22;
  const h = Math.round(size * (1 - pad * 2));
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d' }}>
        <svg width={Math.round(h * 0.84)} height={h} viewBox={ZERO_VIEWBOX}>
          <path d={ZERO_PATH} fill="#ffffff" fillRule="evenodd" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { 'cache-control': 'public, max-age=86400, immutable' } },
  );
}
