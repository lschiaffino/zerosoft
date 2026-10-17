'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ProductKey } from '@/lib/products';
import ProductGlyph from '@/components/brand/ProductGlyph';

interface ShowcaseTabsProps {
  /** Nombre de la lista de pestañas para lectores de pantalla. */
  label: string;
  tabs: Array<{ key: ProductKey; label: string }>;
  /** Un panel por pestaña, en el mismo orden (los mockups se renderizan en el servidor). */
  panels: ReactNode[];
}

/** Pestañas de la vitrina del home: muestra un producto por vez. */
export default function ShowcaseTabs({ label, tabs, panels }: ShowcaseTabsProps) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // Flechas izquierda/derecha recorren las pestañas (patrón WAI-ARIA tabs).
  const onKey = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: (active + 1) % tabs.length,
      ArrowLeft: (active + last) % tabs.length,
      Home: 0,
      End: last,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = moves[e.key];
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="showcase">
      <div className="showcase-tabs ui-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`showcase-tab-${tab.key}`}
            aria-selected={i === active}
            aria-controls={`showcase-panel-${tab.key}`}
            tabIndex={i === active ? 0 : -1}
            className={`ui-tab showcase-tab card-${tab.key}`}
            onClick={() => setActive(i)}
          >
            <ProductGlyph product={tab.key} size={14} />
            {tab.label}
          </button>
        ))}
      </div>
      {panels.map((panel, i) => (
        <div
          key={tabs[i].key}
          role="tabpanel"
          id={`showcase-panel-${tabs[i].key}`}
          aria-labelledby={`showcase-tab-${tabs[i].key}`}
          hidden={i !== active}
          className="showcase-panel"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
