import { ImageResponse } from 'next/og';
import { ZERO_PATH, ZERO_VIEWBOX } from '@/lib/zero-mark';

export const dynamic = 'force-static';

/** Imagen para compartir del sitio (PNG: WhatsApp, X y LinkedIn no muestran SVG): el cero blanco sobre tinta. */
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 48,
          background: '#0d0d0d',
          color: '#ffffff',
          fontSize: 112,
          fontWeight: 600,
          letterSpacing: -4,
        }}
      >
        <svg width="150" height="180" viewBox={ZERO_VIEWBOX}>
          <path d={ZERO_PATH} fill="#ffffff" fillRule="evenodd" />
        </svg>
        <span>zerosoft</span>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
