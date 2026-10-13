'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ProductKey } from '@/lib/products';
import ProductZero from '@/components/zero/ProductZero';

interface ShowcaseTabsProps {
  tabs: Array<{ key: ProductKey; label: string }>;
  /** Un panel por pestaña, en el mismo orden (los mockups se renderizan en el servidor). */
  panels: ReactNode[];
}

/** Pestañas de la vitrina del home: muestra un producto por vez. */
export default function ShowcaseTabs({ tabs, panels }: ShowcaseTabsProps) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // Flechas izquierda/derecha recorren las pestañas (patrón WAI-ARIA tabs).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (active + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="showcase">
      <div className="showcase-tabs" role="tablist" onKeyDown={onKey}>
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
            className={`showcase-tab card-${tab.key}${i === active ? ' active' : ''}`}
            onClick={() => setActive(i)}
          >
            <ProductZero product={tab.key} />
            <span className="showcase-tab-name">{tab.label}</span>
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
