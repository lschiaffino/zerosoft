'use client';

import { useState, type CSSProperties } from 'react';
import { NET_H, NET_LINES, NET_STATIONS, NET_W, type NetStation } from '@/lib/brand-network';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';

/** Radio exterior y anillo de una estación del plano (0,44 del radio). */
const R = 18;
const RING = 8;
/** Distancia entre los dos anillos de una combinación. */
const PAIR = 44;
/** Radio de la zona de toque invisible: 32 unidades son ≥ 24 px aun con el plano a 0,75. */
const HIT = 32;

export interface NetworkMapLabels {
  /** Nombre del plano para lectores de pantalla. */
  title: string;
  /** Texto del pie cuando no hay nada encendido (puntero y táctil). */
  hint: string;
  hintTouch: string;
  /** Qué hace cada línea con las otras (pie al encenderla). */
  lines: Record<ProductKey, string>;
  /** Nombre corto y descripción de cada estación de combinación. */
  stations: Record<string, { name: string; desc: string }>;
}

/**
 * El plano de la suite. Pasar o enfocar una línea la enciende y apaga el
 * resto; cada estación es un link a la página del producto. Las líneas se
 * dibujan una vez al cargar (stroke-dashoffset), salvo con movimiento reducido.
 */
export default function NetworkMap({
  locale,
  labels,
  className = '',
  showStationNames = true,
  hrefs,
}: {
  locale: string;
  labels: NetworkMapLabels;
  className?: string;
  showStationNames?: boolean;
  /** Destino de cada línea y estación. Por defecto, la página del producto en el sitio. */
  hrefs?: Partial<Record<ProductKey, string>>;
}) {
  const [active, setActive] = useState<{ lines: ProductKey[]; text: string } | null>(null);
  const on = (k: ProductKey) => !active || active.lines.includes(k);
  const product = (k: ProductKey) => hrefs?.[k] ?? `/${locale}/products/${k}`;

  const lightLine = (k: ProductKey) => setActive({ lines: [k], text: labels.lines[k] });
  const lightStation = (s: NetStation) =>
    setActive({ lines: s.lines, text: `${labels.stations[s.id].name}. ${labels.stations[s.id].desc}` });
  const clear = () => setActive(null);

  const stationOn = (s: NetStation) => !active || s.lines.some((k) => active.lines.includes(k));
  const activeKey = active?.lines.length === 1 ? active.lines[0] : null;

  return (
    <figure className={`net ${active ? 'is-lit' : ''} ${className}`.trim()}>
      <svg
        className="net-svg"
        viewBox={`0 0 ${NET_W} ${NET_H}`}
        role="group"
        aria-label={labels.title}
        onPointerLeave={clear}
      >
        {/* Líneas: cada una con su color; el trazo invisible ancho es la zona de hover. */}
        {NET_LINES.map((l, i) => (
          <g
            key={l.key}
            className={`net-line ${on(l.key) ? '' : 'is-dim'}`.trim()}
            style={{ '--i': i } as CSSProperties}
            onPointerEnter={() => lightLine(l.key)}
          >
            <path className="net-path" d={l.d} pathLength={1} stroke={`var(--c-${l.key})`} />
            <path className="net-hit" d={l.d} />
          </g>
        ))}

        {/* Estaciones de combinación. */}
        {NET_STATIONS.map((s, i) => {
          const name = labels.stations[s.id];
          const lines = s.lines.map((k) => PRODUCT_CONFIG[k].name).join(', ');
          const dx = s.axis === 'h' ? PAIR / 2 : 0;
          const dy = s.axis === 'v' ? PAIR / 2 : 0;
          return (
            <a
              key={s.id}
              href={product(s.href)}
              className={`net-stop ${stationOn(s) ? '' : 'is-dim'}`.trim()}
              style={{ '--i': i } as CSSProperties}
              aria-label={`${name.name} (${lines}). ${name.desc}`}
              onPointerEnter={() => lightStation(s)}
              onFocus={() => lightStation(s)}
              onBlur={clear}
            >
              <rect
                className="net-focus"
                x={s.x - dx - R - 8}
                y={s.y - dy - R - 8}
                width={2 * (dx + R + 8)}
                height={2 * (dy + R + 8)}
              />
              <circle cx={s.x} cy={s.y} r={HIT} className="net-hit-stop" />
              {s.external || s.lines.length < 2 ? (
                <circle cx={s.x} cy={s.y} r={R - RING / 2} className="net-ring" />
              ) : (
                <>
                  <rect
                    x={s.axis === 'h' ? s.x - dx : s.x - RING / 2}
                    y={s.axis === 'v' ? s.y - dy : s.y - RING / 2}
                    width={s.axis === 'h' ? PAIR : RING}
                    height={s.axis === 'v' ? PAIR : RING}
                    className="net-bar"
                  />
                  <circle cx={s.x - dx} cy={s.y - dy} r={R - RING / 2} className="net-ring" />
                  <circle cx={s.x + dx} cy={s.y + dy} r={R - RING / 2} className="net-ring" />
                </>
              )}
              {showStationNames && (
                <text className="net-station-name" x={s.x + s.label.dx} y={s.y + s.label.dy} textAnchor={s.label.anchor}>
                  {name.name}
                </text>
              )}
            </a>
          );
        })}

        {/* Terminales: el nombre de la línea, link a la página del producto. */}
        {NET_LINES.map((l, i) => (
          <a
            key={l.key}
            href={product(l.key)}
            className={`net-stop net-terminal ${on(l.key) ? '' : 'is-dim'}`.trim()}
            style={{ '--i': i } as CSSProperties}
            aria-label={`${PRODUCT_CONFIG[l.key].name}. ${labels.lines[l.key]}`}
            onPointerEnter={() => lightLine(l.key)}
            onFocus={() => lightLine(l.key)}
            onBlur={clear}
          >
            <rect className="net-focus" x={l.terminal.x - R - 8} y={l.terminal.y - R - 8} width={2 * (R + 8)} height={2 * (R + 8)} />
            <circle cx={l.terminal.x} cy={l.terminal.y} r={HIT} className="net-hit-stop" />
            <circle cx={l.terminal.x} cy={l.terminal.y} r={R - RING / 2} className="net-ring" />
            <text className="net-label" x={l.label.x} y={l.label.y} textAnchor={l.label.anchor}>
              {PRODUCT_CONFIG[l.key].name}
            </text>
          </a>
        ))}
      </svg>
      <figcaption className="net-caption" aria-live="polite">
        <span
          className="net-caption-line"
          aria-hidden="true"
          style={{ background: activeKey ? `var(--c-${activeKey})` : 'var(--brand-ink)' }}
        />
        <span className="net-caption-text">
          {active ? (
            active.text
          ) : (
            <>
              <span className="net-hint-hover">{labels.hint}</span>
              <span className="net-hint-touch">{labels.hintTouch}</span>
            </>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
