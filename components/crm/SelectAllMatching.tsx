'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface MatchingSelection {
  /** La query del listado que el server vuelve a evaluar. */
  query: string;
  /** Cuántos registros toma la acción (los cuenta el server, con tope). */
  count: number;
  /** Cuántos coinciden en total (más que `count` si se pasó el tope). */
  total: number;
}

/** La query del listado tal como la ve la persona, sin la página. */
export function useListQuery(): string {
  const params = useSearchParams();
  const q = new URLSearchParams(params.toString());
  q.delete('page');
  q.delete('per');
  return q.toString();
}

/**
 * El aviso de HubSpot al elegir toda la página: "Se eligieron los 25 de esta
 * página. Elegir los 312 que coinciden con esta vista". Al elegirlos, el
 * server los cuenta con el alcance de la persona (y el tope) y la barra de
 * acciones pasa a actuar sobre la vista entera, no sobre una lista de ids.
 */
export default function SelectAllMatching({
  entity,
  pageCount,
  total,
  matching,
  onMatching,
  onClear,
}: {
  entity: 'contacts' | 'companies' | 'deals';
  /** Filas elegidas en la página. */
  pageCount: number;
  /** Cuántos muestra el listado en total. */
  total: number;
  matching: MatchingSelection | null;
  onMatching: (m: MatchingSelection) => void;
  onClear: () => void;
}) {
  const t = useTranslations('crm.selectAll');
  const query = useListQuery();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function selectAll() {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/crm/${entity}/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'count', matching: { query } }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { count?: number; total?: number } | null;
    if (!res?.ok || typeof data?.count !== 'number') {
      setError(true);
      return;
    }
    onMatching({ query, count: data.count, total: data.total ?? data.count });
  }

  if (matching) {
    return (
      <div className="select-all-banner" role="status" data-testid="select-all-banner">
        <span>
          {matching.total > matching.count
            ? t(`capped.${entity}`, { count: matching.count, total: matching.total })
            : t(`all.${entity}`, { count: matching.count })}
        </span>
        <button type="button" className="link-btn" onClick={onClear} data-testid="select-all-clear">
          {t('clear')}
        </button>
      </div>
    );
  }
  if (pageCount === 0 || total <= pageCount) return null;
  return (
    <div className="select-all-banner" role="status" data-testid="select-all-banner">
      <span>{t('page', { count: pageCount })}</span>
      <button type="button" className="link-btn" onClick={selectAll} disabled={busy} data-testid="select-all-matching">
        {t(`select.${entity}`, { count: total })}
      </button>
      {error && (
        <span className="bulk-error" role="alert">
          {t('error')}
        </span>
      )}
    </div>
  );
}
