'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import CrmIcon from './CrmIcon';
import { CARDS_STORAGE_KEY, parseCollapsed, withCollapsed } from './recordLayout';

// En el server no hay layout: el efecto de layout solo corre en el navegador.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function readCollapsed(id: string): boolean {
  try {
    return parseCollapsed(window.localStorage.getItem(CARDS_STORAGE_KEY))[id] === true;
  } catch {
    return false;
  }
}

function writeCollapsed(id: string, collapsed: boolean) {
  try {
    const map = parseCollapsed(window.localStorage.getItem(CARDS_STORAGE_KEY));
    window.localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(withCollapsed(map, id, collapsed)));
  } catch {
    // Sin almacenamiento (modo privado): la tarjeta se pliega igual, solo no se recuerda.
  }
}

interface RecordCardProps {
  /** Clave del estado plegado: `<objeto>.<tarjeta>` (vale para todos los registros del objeto). */
  id: string;
  /** Nombre de la tarjeta: título visible (salvo `bare`) y nombre del botón de plegar. */
  label: string;
  count?: number;
  /**
   * Texto del botón "Agregar". Va solo con la tarjeta plegada: la abre y lleva el foco a su
   * control de alta. Abierta, ese control ya está a la vista y el botón sobraría. La página lo
   * pasa solo si hay algo para asociar o crear.
   */
  addLabel?: string;
  /**
   * El contenido ya trae su propio título (paneles que existían antes de la
   * ficha en columnas): la tarjeta no repite el título y, plegada, deja a la
   * vista solo esa primera línea.
   */
  bare?: boolean;
  /** Valor a la derecha del título (un puntaje, un total). */
  aside?: ReactNode;
  testId?: string;
  /** Ancla de la tarjeta (`#score`, `#quotes`). */
  anchor?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Tarjeta plegable de la ficha (propiedades a la izquierda, asociaciones a la
 * derecha). Cada persona elige cuáles deja plegadas y el navegador lo recuerda.
 */
export default function RecordCard({
  id,
  label,
  count,
  addLabel,
  bare,
  aside,
  testId,
  anchor,
  className = '',
  children,
}: RecordCardProps) {
  const t = useTranslations('crm.record.cards');
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // El HTML del server llega con la tarjeta abierta (no conoce el navegador); al hidratar,
  // antes del pintado siguiente, se pliega si la persona la había dejado así.
  useBrowserLayoutEffect(() => {
    if (readCollapsed(id)) setCollapsed(true);
  }, [id]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(id, next);
  }

  function add() {
    setCollapsed(false);
    writeCollapsed(id, false);
    // Con la tarjeta ya abierta: el selector de "asociar existente" o, si no hay, el botón de crear.
    window.setTimeout(() => {
      const body = bodyRef.current;
      const target =
        body?.querySelector<HTMLElement>('[data-card-add]') ??
        body?.querySelector<HTMLElement>('.assoc-add-row select, .assoc-add-row button, .assoc-add-row a');
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    }, 0);
  }

  const toggleLabel = t(collapsed ? 'expand' : 'collapse', { name: label });

  return (
    <section
      className={`rec-card${bare ? ' rec-card-bare' : ''} ${className}`.trim()}
      data-collapsed={collapsed ? 'true' : undefined}
      data-card={id}
      data-testid={testId}
      id={anchor}
    >
      <button
        type="button"
        className="rec-card-toggle"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-testid="record-card-toggle"
        onClick={toggle}
      >
        <CrmIcon name="chevronDown" size={14} />
      </button>
      {!bare && (
        <div className="rec-card-head">
          <h2 className="rec-card-title">
            {label}
            {count !== undefined && <span className="rec-card-count num">{count}</span>}
          </h2>
          {aside}
          {addLabel && collapsed && (
            <button type="button" className="btn btn-ghost btn-sm rec-card-add" data-testid="record-card-add" onClick={add}>
              <span aria-hidden="true">+</span> {addLabel}
            </button>
          )}
        </div>
      )}
      <div className="rec-card-body" id={bodyId} ref={bodyRef} hidden={!bare && collapsed}>
        {children}
      </div>
    </section>
  );
}
