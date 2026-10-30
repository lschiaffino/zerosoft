'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  alignDeltas,
  blankPage,
  bounds,
  cloneWithNewIds,
  distributeDeltas,
  expandGroups,
  MAX_ELEMENTS,
  MAX_PAGES,
  newId,
  reorder,
  type AlignMode,
  type DesignDoc,
  type DesignElement,
  type DesignPage,
  type ZMove,
} from '@/lib/design-model';
import { fitTextHeights } from './textLayout';

const HISTORY_LIMIT = 100;
const CLIPBOARD_KEY = 'zs-design-clipboard';

export type Patch = Partial<DesignElement> & Record<string, unknown>;

/**
 * Estado del editor: el diseño, la página abierta, la selección y el
 * historial (deshacer/rehacer). Los gestos (arrastrar, redimensionar,
 * escribir) actualizan en vivo y entran al historial una sola vez al
 * terminar. `rev` sube con cada cambio local: el guardado automático lo mira.
 */
export function useEditor(initial: DesignDoc) {
  const [doc, setDocState] = useState<DesignDoc>(() => ({ ...initial, pages: initial.pages.map(fitTextHeights) }));
  const [pageIndex, setPageIndexState] = useState(0);
  const [selected, setSelectedState] = useState<string[]>([]);
  const [rev, setRev] = useState(0);
  const [, setHistoryTick] = useState(0);
  const docRef = useRef(doc);
  const pageRef = useRef(0);
  const selRef = useRef<string[]>([]);
  const past = useRef<DesignDoc[]>([]);
  const future = useRef<DesignDoc[]>([]);
  const gesture = useRef<DesignDoc | null>(null);

  const apply = useCallback((next: DesignDoc, history: boolean) => {
    const fitted = { ...next, pages: next.pages.map(fitTextHeights) };
    if (history) {
      past.current.push(docRef.current);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current = [];
      setHistoryTick((n) => n + 1);
    }
    docRef.current = fitted;
    setDocState(fitted);
    setRev((r) => r + 1);
  }, []);

  const setSelected = useCallback((ids: string[]) => {
    selRef.current = ids;
    setSelectedState(ids);
  }, []);

  const setPageIndex = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(docRef.current.pages.length - 1, i));
      pageRef.current = n;
      setPageIndexState(n);
      setSelected([]);
    },
    [setSelected],
  );

  const commit = useCallback((next: DesignDoc) => apply(next, true), [apply]);

  /** Empieza un gesto: los cambios van en vivo y entran al historial al terminar. */
  const beginGesture = useCallback(() => {
    if (!gesture.current) gesture.current = docRef.current;
  }, []);
  const live = useCallback((next: DesignDoc) => apply(next, false), [apply]);
  const endGesture = useCallback(() => {
    const start = gesture.current;
    gesture.current = null;
    if (start && start !== docRef.current) {
      past.current.push(start);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current = [];
      setHistoryTick((n) => n + 1);
    }
  }, []);
  const inGesture = useCallback(() => gesture.current !== null, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    docRef.current = prev;
    setDocState(prev);
    setRev((r) => r + 1);
    setHistoryTick((n) => n + 1);
    if (pageRef.current >= prev.pages.length) setPageIndex(prev.pages.length - 1);
    setSelected(selRef.current.filter((id) => prev.pages[pageRef.current]?.elements.some((e) => e.id === id)));
  }, [setPageIndex, setSelected]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    docRef.current = next;
    setDocState(next);
    setRev((r) => r + 1);
    setHistoryTick((n) => n + 1);
    if (pageRef.current >= next.pages.length) setPageIndex(next.pages.length - 1);
    setSelected(selRef.current.filter((id) => next.pages[pageRef.current]?.elements.some((e) => e.id === id)));
  }, [setPageIndex, setSelected]);

  /** Trae la versión de otra persona: sin historial propio (ya no aplica). */
  const replaceFromRemote = useCallback(
    (next: DesignDoc) => {
      past.current = [];
      future.current = [];
      gesture.current = null;
      const fitted = { ...next, pages: next.pages.map(fitTextHeights) };
      docRef.current = fitted;
      setDocState(fitted);
      setHistoryTick((n) => n + 1);
      if (pageRef.current >= next.pages.length) setPageIndex(next.pages.length - 1);
      setSelected(selRef.current.filter((id) => fitted.pages[pageRef.current]?.elements.some((e) => e.id === id)));
    },
    [setPageIndex, setSelected],
  );

  // ---------- Página actual ----------

  const withPage = useCallback((fn: (p: DesignPage) => DesignPage, history = true) => {
    const d = docRef.current;
    const pages = d.pages.map((p, i) => (i === pageRef.current ? fn(p) : p));
    apply({ ...d, pages }, history);
  }, [apply]);

  const updateElements = useCallback(
    (ids: string[], fn: (el: DesignElement) => DesignElement, history = true) => {
      const set = new Set(ids);
      withPage((p) => ({ ...p, elements: p.elements.map((el) => (set.has(el.id) ? fn(el) : el)) }), history);
    },
    [withPage],
  );

  const patchSelected = useCallback(
    (patch: Patch | ((el: DesignElement) => Patch | null), history = true) => {
      const ids = selRef.current;
      if (!ids.length) return;
      updateElements(
        ids,
        (el) => {
          const p = typeof patch === 'function' ? patch(el) : patch;
          return p ? ({ ...el, ...p } as DesignElement) : el;
        },
        history,
      );
    },
    [updateElements],
  );

  const addElements = useCallback(
    (els: DesignElement[], select = true) => {
      const page = docRef.current.pages[pageRef.current];
      if (page.elements.length + els.length > MAX_ELEMENTS) return false;
      withPage((p) => ({ ...p, elements: [...p.elements, ...els] }));
      if (select) setSelected(els.map((e) => e.id));
      return true;
    },
    [withPage, setSelected],
  );

  const deleteSelected = useCallback(() => {
    const ids = new Set(selRef.current);
    if (!ids.size) return;
    withPage((p) => ({ ...p, elements: p.elements.filter((e) => !ids.has(e.id) || e.locked) }));
    setSelected([]);
  }, [withPage, setSelected]);

  const select = useCallback(
    (ids: string[], additive = false) => {
      const els = docRef.current.pages[pageRef.current].elements;
      const expanded = expandGroups(els, ids);
      if (additive) {
        const cur = new Set(selRef.current);
        const allIn = [...expanded].every((id) => cur.has(id));
        for (const id of expanded) {
          if (allIn) cur.delete(id);
          else cur.add(id);
        }
        setSelected(els.filter((e) => cur.has(e.id)).map((e) => e.id));
      } else setSelected(els.filter((e) => expanded.has(e.id)).map((e) => e.id));
    },
    [setSelected],
  );

  const selectAll = useCallback(() => {
    setSelected(docRef.current.pages[pageRef.current].elements.filter((e) => !e.hidden).map((e) => e.id));
  }, [setSelected]);

  const selectedElements = useCallback(() => {
    const ids = new Set(selRef.current);
    return docRef.current.pages[pageRef.current].elements.filter((e) => ids.has(e.id));
  }, []);

  const duplicate = useCallback(() => {
    const els = selectedElements();
    if (!els.length) return;
    const copies = cloneWithNewIds(els).map((e) => ({ ...e, x: e.x + 20, y: e.y + 20, locked: false }) as DesignElement);
    addElements(copies);
  }, [selectedElements, addElements]);

  const group = useCallback(() => {
    const ids = selRef.current;
    if (ids.length < 2) return;
    const g = newId('g');
    updateElements(ids, (el) => ({ ...el, groupId: g }));
  }, [updateElements]);

  const ungroup = useCallback(() => {
    const ids = selRef.current;
    if (!ids.length) return;
    updateElements(ids, (el) => ({ ...el, groupId: null }));
  }, [updateElements]);

  const zorder = useCallback(
    (move: ZMove) => {
      const ids = new Set(selRef.current);
      if (!ids.size) return;
      withPage((p) => ({ ...p, elements: reorder(p.elements, ids, move) }));
    },
    [withPage],
  );

  const moveBy = useCallback(
    (dx: number, dy: number, history = true) => {
      const movable = selectedElements().filter((e) => !e.locked);
      updateElements(
        movable.map((e) => e.id),
        (el) => ({ ...el, x: el.x + dx, y: el.y + dy }),
        history,
      );
    },
    [selectedElements, updateElements],
  );

  const align = useCallback(
    (mode: AlignMode) => {
      const els = selectedElements().filter((e) => !e.locked);
      if (!els.length) return;
      const d = docRef.current;
      // Un grupo se alinea como un bloque (contra la página).
      const single = els.length === 1 || els.every((e) => e.groupId && e.groupId === els[0].groupId);
      if (single) {
        const box = els.map(bounds).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }));
        const [delta] = alignDeltas([box], mode, { w: d.width, h: d.height });
        updateElements(
          els.map((e) => e.id),
          (el) => ({ ...el, x: el.x + delta.x, y: el.y + delta.y }),
        );
        return;
      }
      const deltas = alignDeltas(els.map(bounds), mode, { w: d.width, h: d.height });
      const byId = new Map(els.map((e, i) => [e.id, deltas[i]]));
      updateElements([...byId.keys()], (el) => ({ ...el, x: el.x + byId.get(el.id)!.x, y: el.y + byId.get(el.id)!.y }));
    },
    [selectedElements, updateElements],
  );

  const distribute = useCallback(
    (axis: 'x' | 'y') => {
      const els = selectedElements().filter((e) => !e.locked);
      if (els.length < 3) return;
      const deltas = distributeDeltas(els.map(bounds), axis);
      const byId = new Map(els.map((e, i) => [e.id, deltas[i]]));
      updateElements([...byId.keys()], (el) => ({ ...el, x: el.x + byId.get(el.id)!.x, y: el.y + byId.get(el.id)!.y }));
    },
    [selectedElements, updateElements],
  );

  // ---------- Páginas ----------

  const addPage = useCallback(
    (after = pageRef.current, page?: DesignPage) => {
      const d = docRef.current;
      if (d.pages.length >= MAX_PAGES) return;
      const pages = [...d.pages];
      pages.splice(after + 1, 0, page ?? blankPage());
      commit({ ...d, pages });
      setPageIndex(after + 1);
    },
    [commit, setPageIndex],
  );

  const addPages = useCallback(
    (list: DesignPage[]) => {
      const d = docRef.current;
      const room = MAX_PAGES - d.pages.length;
      if (room <= 0) return;
      const at = pageRef.current + 1;
      const pages = [...d.pages];
      pages.splice(at, 0, ...list.slice(0, room));
      commit({ ...d, pages });
      setPageIndex(at);
    },
    [commit, setPageIndex],
  );

  const duplicatePage = useCallback(
    (i = pageRef.current) => {
      const d = docRef.current;
      addPage(i, cloneWithNewIds(d.pages[i]));
    },
    [addPage],
  );

  const deletePage = useCallback(
    (i = pageRef.current) => {
      const d = docRef.current;
      if (d.pages.length <= 1) return;
      commit({ ...d, pages: d.pages.filter((_, k) => k !== i) });
      setPageIndex(Math.min(i, d.pages.length - 2));
    },
    [commit, setPageIndex],
  );

  const movePage = useCallback(
    (i: number, dir: -1 | 1) => {
      const d = docRef.current;
      const j = i + dir;
      if (j < 0 || j >= d.pages.length) return;
      const pages = [...d.pages];
      [pages[i], pages[j]] = [pages[j], pages[i]];
      commit({ ...d, pages });
      setPageIndex(j);
    },
    [commit, setPageIndex],
  );

  const setBackground = useCallback(
    (bg: Partial<DesignPage['background']>) => {
      withPage((p) => ({ ...p, background: { ...p.background, ...bg } }));
    },
    [withPage],
  );

  // ---------- Portapapeles ----------

  const copy = useCallback(() => {
    const els = selectedElements();
    if (!els.length) return false;
    const payload = JSON.stringify({ kind: 'zs-design', elements: els });
    try {
      localStorage.setItem(CLIPBOARD_KEY, payload);
    } catch {
      /* sin storage: se copia igual al portapapeles del sistema */
    }
    navigator.clipboard?.writeText(payload).catch(() => undefined);
    return true;
  }, [selectedElements]);

  const cut = useCallback(() => {
    if (copy()) deleteSelected();
  }, [copy, deleteSelected]);

  /** Pega elementos copiados (de este u otro diseño). `raw`: texto del portapapeles del sistema. */
  const pasteElements = useCallback(
    (raw?: string | null) => {
      let text = raw ?? null;
      if (!text) {
        try {
          text = localStorage.getItem(CLIPBOARD_KEY);
        } catch {
          text = null;
        }
      }
      if (!text) return false;
      try {
        const data = JSON.parse(text) as { kind?: string; elements?: DesignElement[] };
        if (data.kind !== 'zs-design' || !Array.isArray(data.elements) || !data.elements.length) return false;
        const copies = cloneWithNewIds(data.elements.slice(0, MAX_ELEMENTS)).map((e) => ({ ...e, x: e.x + 20, y: e.y + 20, locked: false }) as DesignElement);
        return addElements(copies);
      } catch {
        return false;
      }
    },
    [addElements],
  );

  const page = doc.pages[Math.min(pageIndex, doc.pages.length - 1)];
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return {
    doc,
    page,
    pageIndex,
    selected,
    selectedSet,
    rev,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    docRef,
    pageRef,
    selRef,
    commit,
    live,
    beginGesture,
    endGesture,
    inGesture,
    undo,
    redo,
    replaceFromRemote,
    setPageIndex,
    setSelected,
    select,
    selectAll,
    selectedElements,
    updateElements,
    patchSelected,
    addElements,
    deleteSelected,
    duplicate,
    group,
    ungroup,
    zorder,
    moveBy,
    align,
    distribute,
    addPage,
    addPages,
    duplicatePage,
    deletePage,
    movePage,
    setBackground,
    copy,
    cut,
    pasteElements,
    withPage,
  };
}

export type Editor = ReturnType<typeof useEditor>;
