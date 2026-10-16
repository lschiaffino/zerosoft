import { ImageResponse } from 'next/og';
import { BRAND_INK, BRAND_WHITE, STATION_RING } from '@/lib/brand';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Ícono para la pantalla de inicio de iOS: la estación blanca sobre la banda negra. */
export default function AppleIcon() {
  const r = 62;
  const w = r * STATION_RING;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND_INK,
        }}
      >
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle cx="90" cy="90" r={r - w / 2} fill={BRAND_INK} stroke={BRAND_WHITE} strokeWidth={w} />
        </svg>
      </div>
    ),
    size,
  );
}
