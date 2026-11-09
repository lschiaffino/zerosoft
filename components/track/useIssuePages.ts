'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { pendingDeleteIds } from './trackUndo';

/** Tamaño de página de /api/track/issues (el server no da más de 100 por pedido). */
export const ISSUES_PAGE_SIZE = 100;

interface PageResponse {
  rows: TrackIssueWithStatus[];
  total: number;
  statusCounts?: Record<string, number>;
  groupCounts?: Record<string, number>;
  subGroupCounts?: Record<string, number>;
}

export interface IssuePages {
  state: 'loading' | 'ok' | 'error';
  /** Total en el servidor con los filtros de la vista. */
  total: number;
  /** Totales por grupo y sub-grupo (para los encabezados), con las claves crudas del server. */
  counts: Pick<PageResponse, 'statusCounts' | 'groupCounts' | 'subGroupCounts'>;
  /** Hay más en el servidor que lo cargado. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Primera página (cambió el filtro, el orden o el alcance). */
  load: () => Promise<void>;
  /** Vuelve a pedir las páginas ya cargadas sin perder el lugar (cambios en vivo, ⌘Z, arrastres). */
  reload: () => Promise<void>;
  /** Página siguiente (scroll infinito o "Load more"). */
  loadMore: () => Promise<void>;
  /** Ajusta el total tras un alta o un borrado optimista. */
  adjustTotal: (delta: number) => void;
}

/**
 * Páginas de issues de una lista: la primera al cambiar la consulta, las
 * siguientes a pedido (sin tope) y la recarga de las ya cargadas. Una
 * respuesta vieja (la búsqueda "l" mientras ya se tipeó "login") se
 * descarta. Los issues con un borrado pendiente (con "Deshacer") no se muestran.
 */
export function useIssuePages(
  query: string,
  setIssues: Dispatch<SetStateAction<TrackIssueWithStatus[]>>,
  opts: { enabled: boolean; loaded: () => number },
): IssuePages {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<IssuePages['counts']>({});
  const [pages, setPages] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);
  const pagesRef = useRef(0);
  pagesRef.current = pages;
  const loadedRef = useRef(opts.loaded);
  loadedRef.current = opts.loaded;

  const fetchPage = useCallback(
    async (page: number): Promise<PageResponse> => {
      const res = await fetch(`/api/track/issues?${query}&page=${page}&pageSize=${ISSUES_PAGE_SIZE}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as PageResponse;
    },
    [query],
  );

  const apply = useCallback(
    (data: PageResponse[], append: TrackIssueWithStatus[] | null) => {
      const hidden = pendingDeleteIds();
      const seen = new Set<string>(append?.map((i) => i.id) ?? []);
      const rows: TrackIssueWithStatus[] = [];
      let gone = 0;
      for (const page of data) {
        for (const row of page.rows) {
          if (hidden.has(row.id)) gone++;
          if (seen.has(row.id) || hidden.has(row.id)) continue;
          seen.add(row.id);
          rows.push(row);
        }
      }
      const last = data[data.length - 1];
      setIssues((prev) => (append ? [...prev.filter((i) => !hidden.has(i.id)), ...rows] : rows));
      setTotal(Math.max(0, last.total - gone));
      setCounts({ statusCounts: last.statusCounts, groupCounts: last.groupCounts, subGroupCounts: last.subGroupCounts });
    },
    [setIssues],
  );

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => (s === 'ok' ? s : 'loading'));
    try {
      const first = await fetchPage(1);
      if (mine !== seq.current) return;
      apply([first], null);
      setPages(1);
      setState('ok');
    } catch {
      if (mine === seq.current) setState('error');
    }
  }, [fetchPage, apply]);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const n = Math.max(1, pagesRef.current);
      const data = await Promise.all(Array.from({ length: n }, (_, i) => fetchPage(i + 1)));
      if (mine !== seq.current) return;
      apply(data, null);
      setState('ok');
    } catch {
      // Un error en una recarga silenciosa deja lo que se ve.
    }
  }, [fetchPage, apply]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const next = pagesRef.current + 1;
      const data = await fetchPage(next);
      if (mine !== seq.current) return;
      setIssues((prev) => {
        const hidden = pendingDeleteIds();
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...data.rows.filter((r) => !seen.has(r.id) && !hidden.has(r.id))];
      });
      setTotal(data.total);
      setCounts({ statusCounts: data.statusCounts, groupCounts: data.groupCounts, subGroupCounts: data.subGroupCounts });
      setPages(next);
    } catch {
      // Se puede reintentar con el botón.
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, setIssues, loadingMore]);

  // La búsqueda cambia la consulta en cada tecla: una espera corta junta las teclas.
  useEffect(() => {
    if (!opts.enabled) return;
    const timer = window.setTimeout(() => void load(), state === 'ok' ? 150 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, opts.enabled]);

  const adjustTotal = useCallback((delta: number) => setTotal((n) => Math.max(0, n + delta)), []);

  return {
    state,
    total,
    counts,
    hasMore: state === 'ok' && total > loadedRef.current(),
    loadingMore,
    load,
    reload,
    loadMore,
    adjustTotal,
  };
}
