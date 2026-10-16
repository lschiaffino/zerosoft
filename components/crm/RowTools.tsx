'use client';

import { useTranslations } from 'next-intl';

const PATHS = {
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  remove: 'M6 6l12 12M18 6L6 18',
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * Subir, bajar y quitar una fila de una lista editable (campos de un
 * formulario, acciones de un workflow, pasos de una secuencia). Íconos
 * dibujados, con nombre accesible y title.
 */
export default function RowTools({
  index,
  count,
  onMove,
  onRemove,
  disabled = false,
  minCount = 0,
  name,
}: {
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  /** Sin onRemove solo se muestran subir y bajar. */
  onRemove?: () => void;
  disabled?: boolean;
  /** Mínimo de filas: con menos, quitar queda deshabilitado. */
  minCount?: number;
  /** Qué fila es, para lectores de pantalla ("Campo 2: Email"). */
  name?: string;
}) {
  const t = useTranslations('crm.rowTools');
  const suffix = name ? `: ${name}` : '';
  return (
    <span className="crm-row-tools">
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => onMove(-1)}
        disabled={disabled || index === 0}
        aria-label={t('up') + suffix}
        title={t('up')}
      >
        <Icon d={PATHS.up} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => onMove(1)}
        disabled={disabled || index === count - 1}
        aria-label={t('down') + suffix}
        title={t('down')}
      >
        <Icon d={PATHS.down} />
      </button>
      {onRemove && (
      <button
        type="button"
        className="btn btn-ghost btn-danger btn-sm btn-icon"
        onClick={onRemove}
        disabled={disabled || count <= minCount}
        aria-label={t('remove') + suffix}
        title={t('remove')}
      >
        <Icon d={PATHS.remove} />
      </button>
      )}
    </span>
  );
}
