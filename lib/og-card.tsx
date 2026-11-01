import fs from 'fs/promises';
import path from 'path';
import { ImageResponse } from 'next/og';
import { ZERO_PATH, ZERO_VIEWBOX } from '@/lib/zero-mark';
import { zeroFieldSVG } from '@/lib/product-og';
import { clampText, titleSize } from '@/lib/og-text';

/**
 * Tarjeta para compartir (1200×630, PNG): WhatsApp, X, LinkedIn y Slack no
 * muestran og:image en SVG. Tinta de fondo, el campo de ceros del producto a
 * la derecha y el texto con las fuentes de la marca (lib/og-fonts, OFL).
 */

export interface OgCardInput {
  /** Clave del campo de ceros (determinístico): "crm", "blog:slug". */
  seed: string;
  /** Línea chica de arriba, en mono: "zerosoft · CRM", "Blog". */
  kicker: string;
  title: string;
  /** Línea de abajo del título (opcional). */
  sub?: string;
  /** Color del campo de ceros (el del producto). */
  color?: string;
  /** Texto de la esquina inferior derecha (por defecto zerosoft.ai). */
  foot?: string;
}

let fonts: Promise<{ name: string; data: Buffer; weight: 500; style: 'normal' }[]> | null = null;

function loadFonts() {
  fonts ??= Promise.all([
    fs.readFile(path.join(process.cwd(), 'lib', 'og-fonts', 'SpaceGrotesk-Medium.ttf')),
    fs.readFile(path.join(process.cwd(), 'lib', 'og-fonts', 'IBMPlexMono-Medium.ttf')),
  ]).then(([sans, mono]) => [
    { name: 'Space Grotesk', data: sans, weight: 500 as const, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: mono, weight: 500 as const, style: 'normal' as const },
  ]);
  return fonts;
}

export async function ogCard(input: OgCardInput): Promise<ImageResponse> {
  const color = input.color ?? '#f4f4f4';
  const field = `data:image/svg+xml;base64,${Buffer.from(zeroFieldSVG(input.seed, color)).toString('base64')}`;
  const title = clampText(input.title, 110);
  const sub = input.sub ? clampText(input.sub, 120) : '';
  const size = titleSize(title);

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: '#0a0a0a', color: '#ffffff', fontFamily: 'Space Grotesk' }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={field} width={1200} height={630} style={{ position: 'absolute', left: 0, top: 0, opacity: 0.55 }} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: '60px 64px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <svg width="34" height="40" viewBox={ZERO_VIEWBOX}>
              <path d={ZERO_PATH} fill="#ffffff" fillRule="evenodd" />
            </svg>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 26, opacity: 0.7, letterSpacing: 0 }}>{input.kicker}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 940 }}>
            <div style={{ fontSize: size, lineHeight: 1.04, letterSpacing: size > 70 ? -3 : -1.5, display: 'flex' }}>{title}</div>
            {sub ? <div style={{ fontSize: 30, lineHeight: 1.3, opacity: 0.68, display: 'flex' }}>{sub}</div> : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 24, opacity: 0.55 }}>{input.foot ?? 'zerosoft.ai'}</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: await loadFonts(),
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400' },
    },
  );
}
