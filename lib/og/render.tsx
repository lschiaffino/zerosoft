import fs from 'fs/promises';
import path from 'path';
import { ImageResponse } from 'next/og';
import { ZERO_PATH, ZERO_VIEWBOX } from '@/lib/zero-mark';
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from '@/lib/products';
import { artLayers } from './art';
import { clampText, fitText, titleTracking } from './text';

/**
 * Las tarjetas para compartir de zerosoft (og:image), en PNG: WhatsApp, X,
 * LinkedIn y Slack no muestran SVG. Dos formatos: ancho (1200×630, el de
 * todos) y cuadrado (1200×1200, el recorte de WhatsApp y los chats). Dos
 * temas: tinta (marketing) y papel (docs, legales, contenido de clientes).
 *
 * El dibujo es el toroide de ceros de la home, teñido con el color de la app,
 * con ceros que se desprenden hacia el texto. Las fuentes son las de la marca
 * (lib/og-fonts, OFL), leídas del disco: nada se baja en el momento.
 *
 * Legible a 300 px de ancho (lo que muestra WhatsApp): el título nunca baja
 * de 52 px (13 px en la vista chica) y todo vive a 64 px del borde, fuera del
 * recorte 2:1 de X.
 */

export type OgFormat = 'wide' | 'square';
export type OgTheme = 'ink' | 'paper';

export interface OgSpec {
  /** Semilla del dibujo (determinístico): "product:crm", "blog:slug". */
  seed: string;
  title: string;
  /** Una línea corta debajo del título. */
  sub?: string;
  /** La app de la página: color del cero y su nombre al lado de la marca. */
  product?: ProductKey;
  /** Etiqueta al lado de la marca cuando no hay app ("Blog", "Docs"). */
  label?: string;
  /** Ruta que se lee abajo: "zerosoft.ai/products/crm". */
  url?: string;
  theme?: OgTheme;
  /** Home: la fila de los ceros de todas las apps. */
  apps?: boolean;
  /**
   * Contenido de un workspace (un video, una página, un formulario): manda el
   * nombre del workspace (o de quien lo publica) en lugar de la marca.
   */
  owner?: string;
  /** Video: el cuadro de portada (data URI PNG/JPEG) y la duración. */
  poster?: { src: string; duration?: string };
}

export const OG_SIZE: Record<OgFormat, { width: number; height: number }> = {
  wide: { width: 1200, height: 630 },
  square: { width: 1200, height: 1200 },
};

const PALETTE: Record<OgTheme, { bg: string; fg: string; fg2: string; fg3: string; rule: string; art: number[] }> = {
  // Opacidad de cada nivel de luz del toroide (·, °, o, 0, Ø).
  ink: { bg: '#0d0d0d', fg: '#ffffff', fg2: '#b3b3b3', fg3: '#8a8a8a', rule: '#2a2a2a', art: [0.3, 0.46, 0.64, 0.84, 1] },
  paper: { bg: '#ffffff', fg: '#0d0d0d', fg2: '#4a4a4a', fg3: '#6e6e6e', rule: '#e8e8e8', art: [0.42, 0.6, 0.76, 0.9, 1] },
};

/** Tinta legible de cada app sobre papel (DESIGN.md: el color de la app nunca es texto). */
function accentFor(theme: OgTheme, product?: ProductKey): string {
  if (!product) return theme === 'ink' ? '#ffffff' : '#0d0d0d';
  return PRODUCT_CONFIG[product].color;
}

type Font = { name: string; data: Buffer; weight: 500; style: 'normal' };
let fonts: Promise<Font[]> | null = null;

function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all([
    fs.readFile(path.join(process.cwd(), 'lib', 'og-fonts', 'SpaceGrotesk-Medium.ttf')),
    fs.readFile(path.join(process.cwd(), 'lib', 'og-fonts', 'IBMPlexMono-Medium.ttf')),
  ]).then(([sans, mono]) => [
    { name: 'Space Grotesk', data: sans, weight: 500 as const, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: mono, weight: 500 as const, style: 'normal' as const },
  ]);
  return fonts;
}

function Zero({ size, color }: { size: number; color: string }) {
  return (
    <svg width={Math.round((size * 20) / 24)} height={size} viewBox={ZERO_VIEWBOX}>
      <path d={ZERO_PATH} fill={color} fillRule="evenodd" />
    </svg>
  );
}

/* La grilla del dibujo: IBM Plex Mono avanza 0.6 em; la fila mide el doble de la columna (el toroide asume celdas 1:2). */
const ART_FONT = 17;
const CELL_W = ART_FONT * 0.6;
const CELL_H = CELL_W * 2;

function Art({ spec, format, theme }: { spec: OgSpec; format: OgFormat; theme: OgTheme }) {
  const { width, height } = OG_SIZE[format];
  const cols = Math.ceil(width / CELL_W);
  const rows = Math.ceil(height / CELL_H);
  const wide = format === 'wide';
  const layers = artLayers(spec.seed, {
    cols,
    rows,
    cx: wide ? cols * 0.83 : cols * 0.7,
    cy: wide ? rows * 0.5 : rows * 0.27,
    size: wide ? 66 : 70,
    drift: spec.owner ? 0.5 : 1,
    driftEnd: wide ? Math.round(cols * 0.48) : Math.round(cols * 0.2),
  });
  const color = accentFor(theme, spec.product);
  const pal = PALETTE[theme];
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width, height, display: 'flex' }}>
      {/* Cada fila de cada capa, desde su primer carácter: menos espacios que medir, el render tarda la mitad. */}
      {layers.flatMap((layer, i) =>
        layer.split('\n').flatMap((line, y) => {
          const x = line.search(/\S/);
          if (x < 0) return [];
          return [
            <div
              key={`${i}:${y}`}
              style={{
                position: 'absolute',
                left: x * CELL_W,
                top: y * CELL_H,
                display: 'flex',
                whiteSpace: 'pre',
                fontFamily: 'IBM Plex Mono',
                fontSize: ART_FONT,
                lineHeight: `${CELL_H}px`,
                letterSpacing: 0,
                color,
                opacity: pal.art[i],
              }}
            >
              {line.slice(x)}
            </div>,
          ];
        }),
      )}
    </div>
  );
}

/** La fila de ceros de las apps (home): cada una en su color, como el catálogo. Un solo SVG: un render. */
function AppZeros({ size, gap }: { size: number; gap: number }) {
  const w = Math.round((size * 20) / 24);
  const step = w + gap;
  const paths = PRODUCT_KEYS.map(
    (k, i) => `<path transform="translate(${i * step} 0) scale(${size / 24})" d="${ZERO_PATH}" fill="${PRODUCT_CONFIG[k].color}" fill-rule="evenodd"/>`,
  ).join('');
  const total = PRODUCT_KEYS.length * step - gap;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${size}" viewBox="0 0 ${total} ${size}">${paths}</svg>`;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`} width={total} height={size} />;
}

function Brand({ spec, theme, size }: { spec: OgSpec; theme: OgTheme; size: number }) {
  const pal = PALETTE[theme];
  const product = spec.product ? PRODUCT_CONFIG[spec.product] : null;
  const label = product?.name ?? spec.label;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.55) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.45) }}>
        <Zero size={Math.round(size * 1.35)} color={pal.fg} />
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: size, color: pal.fg }}>zerosoft.ai</span>
      </div>
      {label ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.45) }}>
          <div style={{ width: 2, height: Math.round(size * 1.3), background: pal.rule, display: 'flex' }} />
          {product ? <Zero size={Math.round(size * 1.35)} color={product.color} /> : null}
          <span style={{ fontFamily: 'Space Grotesk', fontSize: size * 1.05, color: pal.fg }}>{label}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Dueño del contenido (un workspace): su nombre en lugar de la marca, con el cero de la app. */
function Owner({ spec, theme, size }: { spec: OgSpec; theme: OgTheme; size: number }) {
  const pal = PALETTE[theme];
  const product = spec.product ? PRODUCT_CONFIG[spec.product] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.5) }}>
      {product ? <Zero size={Math.round(size * 1.35)} color={product.color} /> : null}
      <span style={{ fontFamily: 'Space Grotesk', fontSize: size * 1.05, color: pal.fg }}>{clampText(spec.owner ?? '', 40)}</span>
      {spec.label ? <span style={{ fontFamily: 'Space Grotesk', fontSize: size * 1.05, color: pal.fg3 }}>{spec.label}</span> : null}
    </div>
  );
}

function Title({ spec, theme, width, maxLines, sizes, subSize = 32 }: { spec: OgSpec; theme: OgTheme; width: number; maxLines: number; sizes?: number[]; subSize?: number }) {
  const pal = PALETTE[theme];
  const { size, text: title } = fitText(clampText(spec.title, 140), width, maxLines, sizes);
  // La línea de abajo: hasta dos líneas, recortada por palabra.
  const sub = spec.sub ? fitText(spec.sub, Math.min(width, 960), 2, [subSize]).text : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(size * 0.3), maxWidth: width }}>
      <div
        style={{
          display: 'block',
          fontFamily: 'Space Grotesk',
          fontSize: size,
          lineHeight: 1.02,
          letterSpacing: titleTracking(size),
          color: pal.fg,
        }}
      >
        {title}
      </div>
      {sub ? (
        <div style={{ display: 'block', fontFamily: 'Space Grotesk', fontSize: subSize, lineHeight: 1.28, color: pal.fg2, maxWidth: Math.min(width, 960) }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** La dirección, en mono, recortada al ancho de la columna de texto (no pisa el dibujo). */
function Foot({ spec, theme, size, width }: { spec: OgSpec; theme: OgTheme; size: number; width: number }) {
  const pal = PALETTE[theme];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: size, color: pal.fg3 }}>{clampMono(spec.url ?? 'zerosoft.ai', Math.floor(width / (size * 0.6)))}</span>
    </div>
  );
}

/** Recorte de una dirección: el final con "…" (la ruta larga se entiende por el principio). */
function clampMono(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/* ------------------------------------------------------------------ */

function Card({ spec, format }: { spec: OgSpec; format: OgFormat }) {
  const theme = spec.theme ?? 'ink';
  const pal = PALETTE[theme];
  const { width, height } = OG_SIZE[format];
  const wide = format === 'wide';
  const pad = wide ? 64 : 80;
  const textWidth = wide ? 620 : width - pad * 2;

  return (
    <div style={{ width, height, display: 'flex', position: 'relative', background: pal.bg, color: pal.fg, fontFamily: 'Space Grotesk' }}>
      <Art spec={spec} format={format} theme={theme} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: `${wide ? 60 : 80}px ${pad}px` }}>
        {spec.owner ? <Owner spec={spec} theme={theme} size={wide ? 28 : 34} /> : <Brand spec={spec} theme={theme} size={wide ? 26 : 32} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: wide ? 40 : 56 }}>
          <Title spec={spec} theme={theme} width={textWidth} maxLines={3} sizes={wide ? undefined : [120, 108, 96, 84, 72, 64]} subSize={wide ? 32 : 42} />
          {spec.apps ? (
            <AppZeros size={wide ? 24 : 30} gap={wide ? 8 : 11} />
          ) : (
            <Foot spec={spec} theme={theme} size={wide ? 22 : 28} width={textWidth} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Video: el cuadro de portada a sangre, el botón de play y el título sobre un velo. */
function VideoCard({ spec, format }: { spec: OgSpec; format: OgFormat }) {
  const { width, height } = OG_SIZE[format];
  const wide = format === 'wide';
  const poster = spec.poster!;
  const pad = wide ? 64 : 80;
  const play = wide ? 132 : 180;
  return (
    <div style={{ width, height, display: 'flex', position: 'relative', background: '#0d0d0d', color: '#ffffff', fontFamily: 'Space Grotesk' }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={poster.src} width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, width, height, objectFit: 'cover' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width, height, display: 'flex', background: 'linear-gradient(180deg, rgba(13,13,13,0.55) 0%, rgba(13,13,13,0.05) 30%, rgba(13,13,13,0.15) 55%, rgba(13,13,13,0.9) 100%)' }} />
      <div style={{ position: 'absolute', left: (width - play) / 2, top: (height - play) / 2 - (wide ? 30 : 60), width: play, height: play, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,13,13,0.78)', borderRadius: play / 2, border: '3px solid rgba(255,255,255,0.9)' }}>
        <svg width={play * 0.36} height={play * 0.42} viewBox="0 0 12 14">
          <path d="M1 0.8 L11.4 7 L1 13.2 Z" fill="#ffffff" />
        </svg>
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: `${wide ? 52 : 72}px ${pad}px` }}>
        <Owner spec={spec} theme="ink" size={wide ? 28 : 34} />
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32 }}>
          <Title spec={{ ...spec, sub: undefined }} theme="ink" width={wide ? 860 : width - pad * 2 - 160} maxLines={2} sizes={wide ? [72, 64, 58, 52] : [96, 84, 72, 64]} />
          {poster.duration ? (
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: wide ? 30 : 38, color: '#ffffff', background: 'rgba(13,13,13,0.82)', padding: '6px 14px', borderRadius: 3 }}>{poster.duration}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export interface RenderOptions {
  format?: OgFormat;
  /** Cache-Control de la respuesta. */
  cache?: string;
}

export const OG_CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
/** Sin versión en la URL (o contenido de un workspace, que puede cambiar o dejar de ser público). */
export const OG_CACHE_SHORT = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

export async function renderOg(spec: OgSpec, opts: RenderOptions = {}): Promise<ImageResponse> {
  const format = opts.format ?? 'wide';
  const { width, height } = OG_SIZE[format];
  return new ImageResponse(spec.poster ? <VideoCard spec={spec} format={format} /> : <Card spec={spec} format={format} />, {
    width,
    height,
    fonts: await loadFonts(),
    headers: { 'Cache-Control': opts.cache ?? OG_CACHE_SHORT },
  });
}
