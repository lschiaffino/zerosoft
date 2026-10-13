'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Ventana de código con pestañas (Request / Response / Webhook…).
 * Los paneles llegan renderizados desde el servidor; acá solo se alterna.
 */
export default function CodeTabs({
  id,
  title,
  tabs,
  panels,
}: {
  id: string;
  title?: string;
  tabs: string[];
  panels: ReactNode[];
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (active + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="code-win">
      <div className="code-win-bar">
        <span className="code-win-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="cw-tabs" role="tablist" aria-label={title} onKeyDown={onKey}>
          {tabs.map((label, i) => (
            <button
              key={label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${id}-panel-${i}`}
              tabIndex={i === active ? 0 : -1}
              className={`cw-tab${i === active ? ' active' : ''}`}
              onClick={() => setActive(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {panels.map((panel, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== active}
          className="code-win-body"
          tabIndex={0}
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
