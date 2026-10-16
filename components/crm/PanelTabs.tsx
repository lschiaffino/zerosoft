'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface PanelTab {
  key: string;
  label: string;
  /** Marca de error en la pestaña (p. ej. un campo inválido adentro). */
  invalid?: boolean;
}

/**
 * Pestañas dentro de un mismo formulario (.ui-tabs con role="tab"): cambian
 * qué grupo de campos se ve sin desmontar los demás, así un solo Guardar
 * manda todo. Flechas, Inicio y Fin mueven el foco y activan.
 */
export function PanelTabs({
  items,
  active,
  onChange,
  idBase,
  label,
  level = 'top',
}: {
  items: PanelTab[];
  active: string;
  onChange: (key: string) => void;
  idBase: string;
  label: string;
  /** `sub`: pestañas dentro de otra pestaña de la página; más chicas y sin filete propio. */
  level?: 'top' | 'sub';
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].key);
    refs.current[next]?.focus();
  }

  return (
    <div className={level === 'sub' ? 'ui-tabs crm-subtabs' : 'ui-tabs'} role="tablist" aria-label={label}>
      {items.map((tab, i) => (
        <button
          key={tab.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.key}`}
          aria-controls={`${idBase}-panel-${tab.key}`}
          aria-selected={tab.key === active}
          tabIndex={tab.key === active ? 0 : -1}
          className="ui-tab"
          onClick={() => onChange(tab.key)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {tab.label}
          {tab.invalid && <span className="crm-tab-flag" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idBase,
  tab,
  active,
  children,
  className = '',
}: {
  idBase: string;
  tab: string;
  active: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tab}`}
      aria-labelledby={`${idBase}-tab-${tab}`}
      hidden={tab !== active}
      className={className || undefined}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
