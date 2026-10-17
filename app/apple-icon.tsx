import { ImageResponse } from 'next/og';
import { ZERO_PATH, ZERO_VIEWBOX } from '@/lib/zero-mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Ícono para la pantalla de inicio de iOS: el cero de la marca, blanco sobre tinta. */
export default function AppleIcon() {
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
        <svg width="92" height="110" viewBox={ZERO_VIEWBOX}>
          <path d={ZERO_PATH} fill="#ffffff" fillRule="evenodd" />
        </svg>
      </div>
    ),
    size,
  );
}
