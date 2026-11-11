'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import PanelSplitter from '@/components/ui/PanelSplitter';
import { LINES_LAYOUT, linesPanelMode, linesPanelsKey, parseSavedPanels, resolveLinesPanels, type LinesPanelMode, type PanelsLayout, type SavedPanels } from '@/lib/groups-panels';

// En el servidor no hay layout que medir: el efecto corre solo en el navegador.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const VARS = { list: '--gr-list-w', details: '--gr-details-w' } as const;

/**
 * Los dos divisores de la bandeja de Lines: lista | conversación y
 * conversación | detalles. Van como hijos directos de .gr-inbox y le ponen
 * --gr-list-w y --gr-details-w (styles/groups-wa.css arma la grilla con
 * ellas). Los anchos quedan en localStorage por persona y se acomodan a la
 * ventana cada vez que cambia de tamaño. En una sola columna no se usan.
 */
export default function PanelSplitters({
  me,
  storageKey,
  layout = LINES_LAYOUT,
  hasDetails = true,
  labels,
}: {
  me: string;
  /** Clave en localStorage; por defecto la de Lines. */
  storageKey?: string;
  layout?: PanelsLayout;
  /** false: no hay panel de detalles a la vista (Inbox sin la info abierta). */
  hasDetails?: boolean;
  /** Textos de cada app (cada ruta carga sus propios mensajes). */
  labels: { list: string; details: string; hint: string };
}) {
  const text = labels;
  const anchor = useRef<HTMLSpanElement>(null);
  const [saved, setSaved] = useState<SavedPanels>({});
  // Hasta medir: un escritorio común, igual en el servidor y en el navegador.
  const [box, setBox] = useState<{ width: number; mode: LinesPanelMode }>({ width: 1200, mode: 'three' });
  const [ready, setReady] = useState(false);
  const key = storageKey ?? linesPanelsKey(me);

  useBrowserLayoutEffect(() => {
    const el = anchor.current?.parentElement;
    if (!el) return;
    try {
      setSaved(parseSavedPanels(window.localStorage.getItem(key)));
    } catch {
      /* sin almacenamiento: anchos por defecto */
    }
    const measure = () => {
      const next = { width: el.clientWidth, mode: linesPanelMode(window.innerWidth, layout, hasDetails) };
      setBox((b) => (b.width === next.width && b.mode === next.mode ? b : next));
    };
    measure();
    setReady(true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      for (const v of Object.values(VARS)) el.style.removeProperty(v);
    };
  }, [key, layout, hasDetails]);

  const { list, details } = resolveLinesPanels(saved, box.width, box.mode, layout);
  const listW = list?.custom ? list.value : null;
  const detailsW = details?.custom ? details.value : null;

  useBrowserLayoutEffect(() => {
    const el = anchor.current?.parentElement;
    if (!el || !ready) return;
    const put = (name: string, w: number | null) => (w == null ? el.style.removeProperty(name) : el.style.setProperty(name, `${w}px`));
    put(VARS.list, listW);
    put(VARS.details, detailsW);
    // Lo que puso el script de antes del primer pintado ya no hace falta.
    for (const v of Object.values(VARS)) document.documentElement.style.removeProperty(v);
  }, [ready, listW, detailsW]);

  const store = useCallback(
    (next: SavedPanels) => {
      try {
        if (next.list == null && next.details == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* modo privado o disco lleno: vale para esta sesión */
      }
    },
    [key],
  );

  const change = (which: keyof SavedPanels, width: number | undefined, persist: boolean) => {
    const next = { ...saved, [which]: width };
    if (width == null) delete next[which];
    setSaved(next);
    if (persist) store(next);
  };

  return (
    <>
      <span ref={anchor} hidden />
      {list && (
        <PanelSplitter
          className="gr-splitter gr-splitter-list"
          label={text.list}
          hint={text.hint}
          side="start"
          value={list.value}
          min={list.min}
          max={list.max}
          onResize={(w) => change('list', w, false)}
          onCommit={(w) => change('list', w, true)}
          onReset={() => change('list', undefined, true)}
        />
      )}
      {details && (
        <PanelSplitter
          className="gr-splitter gr-splitter-details"
          label={text.details}
          hint={text.hint}
          side="end"
          value={details.value}
          min={details.min}
          max={details.max}
          onResize={(w) => change('details', w, false)}
          onCommit={(w) => change('details', w, true)}
          onReset={() => change('details', undefined, true)}
        />
      )}
    </>
  );
}
