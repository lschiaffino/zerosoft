'use client';

import { useId, type ReactNode, type Ref, type SVGProps } from 'react';
import { iconPath } from '@/lib/design-icons';
import { dashArray, imagePlacement, linePaths, lineX, shapePath, type DesignDoc, type DesignElement, type DesignPage, type ImageEl } from '@/lib/design-model';
import { fontFamily } from './fonts';
import { layoutText } from './textLayout';

/** URL (de nuestro origen) de una imagen de Design; `token` = link público. */
export function fileHref(id: string, token?: string | null): string {
  return `/api/design/files/${encodeURIComponent(id)}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
}

/** Línea base de cada renglón: la misma fórmula en el SVG y en canvas. */
export function baselineY(i: number, size: number, lineHeight: number): number {
  const lh = size * lineHeight;
  return i * lh + lh / 2 + size * 0.35;
}

function maskPath(el: ImageEl): string {
  if (el.mask === 'circle') return shapePath('ellipse', el.w, el.h);
  if (el.mask === 'rounded') return shapePath('rect', el.w, el.h, Math.min(el.w, el.h) * 0.12);
  return shapePath('rect', el.w, el.h);
}

export function ElementSvg({ el, uid, token, placeholderLabel }: { el: DesignElement; uid: string; token?: string | null; placeholderLabel?: string }) {
  const transform = `translate(${el.x} ${el.y})${el.rotation ? ` rotate(${el.rotation} ${el.w / 2} ${el.h / 2})` : ''}`;
  const common = { transform, opacity: el.opacity, 'data-el': el.id } as const;
  switch (el.type) {
    case 'text': {
      const layout = layoutText(el);
      return (
        <g {...common}>
          <rect width={el.w} height={el.h} fill="transparent" />
          <text
            fill={el.color}
            style={{ fontFamily: fontFamily(el.font), fontSize: el.size, fontWeight: el.weight, fontStyle: el.italic ? 'italic' : 'normal', whiteSpace: 'pre' }}
            letterSpacing={el.letterSpacing || undefined}
            textDecoration={el.underline ? 'underline' : undefined}
          >
            {layout.lines.map((line, i) => (
              <tspan key={i} x={lineX(el.align, el.w, line.width)} y={baselineY(i, el.size, el.lineHeight)}>
                {line.text || ' '}
              </tspan>
            ))}
          </text>
        </g>
      );
    }
    case 'shape':
      return (
        <g {...common}>
          <path d={shapePath(el.shape, el.w, el.h, el.radius)} fill={el.fill} stroke={el.strokeWidth > 0 ? el.stroke : 'none'} strokeWidth={el.strokeWidth || undefined} strokeLinejoin="round" />
        </g>
      );
    case 'line': {
      const { line, heads } = linePaths(el);
      const dash = dashArray(el.dash, el.strokeWidth);
      return (
        <g {...common}>
          <rect y={el.h / 2 - 8} width={el.w} height={16} fill="transparent" />
          <path d={line} stroke={el.stroke} strokeWidth={el.strokeWidth} strokeDasharray={dash.length ? dash.join(' ') : undefined} strokeLinecap="round" fill="none" />
          {heads.map((d, i) => (
            <path key={i} d={d} stroke={el.stroke} strokeWidth={el.strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
        </g>
      );
    }
    case 'icon': {
      const d = iconPath(el.icon);
      return (
        <g {...common}>
          <rect width={el.w} height={el.h} fill="transparent" />
          {d && (
            <path
              d={d}
              transform={`scale(${el.w / 24} ${el.h / 24})`}
              fill="none"
              stroke={el.color}
              strokeWidth={el.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      );
    }
    case 'image': {
      const clip = `${uid}-c-${el.id}`;
      const mask = maskPath(el);
      if (!el.src) {
        const s = Math.min(el.w, el.h) * 0.22;
        return (
          <g {...common}>
            <path d={mask} fill="#d9dde3" />
            <path d={mask} fill="none" stroke="#9aa3ad" strokeWidth={Math.max(1, Math.min(el.w, el.h) / 160)} strokeDasharray="6 6" />
            <path
              d={iconPath('image') ?? ''}
              transform={`translate(${el.w / 2 - s / 2} ${el.h / 2 - s / 2}) scale(${s / 24})`}
              fill="none"
              stroke="#6b7480"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {placeholderLabel && el.w > 160 && (
              <text x={el.w / 2} y={el.h / 2 + s} textAnchor="middle" fill="#4b5560" style={{ fontSize: Math.max(10, Math.min(28, el.w / 14)), fontFamily: 'Arial, sans-serif' }}>
                {placeholderLabel}
              </text>
            )}
          </g>
        );
      }
      const p = imagePlacement(el);
      const flip = el.flipX || el.flipY ? `translate(${el.flipX ? el.w : 0} ${el.flipY ? el.h : 0}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})` : undefined;
      return (
        <g {...common}>
          <defs>
            <clipPath id={clip}>
              <path d={mask} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clip})`}>
            <g transform={flip}>
              <image href={fileHref(el.src, token)} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="none" />
            </g>
          </g>
        </g>
      );
    }
  }
}

export function PageBackground({ doc, page, token }: { doc: DesignDoc; page: DesignPage; token?: string | null }) {
  return (
    <>
      <rect width={doc.width} height={doc.height} fill={page.background.color} />
      {page.background.image && (
        <image href={fileHref(page.background.image, token)} width={doc.width} height={doc.height} preserveAspectRatio="xMidYMid slice" />
      )}
    </>
  );
}

/**
 * Una página como SVG en su tamaño real (viewBox) y mostrada a `displayWidth`
 * px. `hiddenIds`: elementos que no se dibujan (el texto que se está editando).
 */
export default function PageSvg({
  doc,
  page,
  displayWidth,
  token,
  hiddenIds,
  placeholderLabel,
  children,
  svgRef,
  className,
  title,
  ...rest
}: {
  doc: DesignDoc;
  page: DesignPage;
  displayWidth?: number;
  token?: string | null;
  hiddenIds?: Set<string>;
  placeholderLabel?: string;
  children?: ReactNode;
  svgRef?: Ref<SVGSVGElement>;
  className?: string;
  title?: string;
} & Omit<SVGProps<SVGSVGElement>, 'ref' | 'children'>) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const w = displayWidth ?? doc.width;
  const h = (w * doc.height) / doc.width;
  const pageClip = `${uid}-page`;
  return (
    <svg
      ref={svgRef}
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${doc.width} ${doc.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-label={title}
      overflow="visible"
      {...rest}
    >
      <defs>
        <clipPath id={pageClip}>
          <rect width={doc.width} height={doc.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${pageClip})`}>
        <PageBackground doc={doc} page={page} token={token} />
        {page.elements.map((el) => (el.hidden || hiddenIds?.has(el.id) ? null : <ElementSvg key={el.id} el={el} uid={uid} token={token} placeholderLabel={placeholderLabel} />))}
      </g>
      {children}
    </svg>
  );
}
