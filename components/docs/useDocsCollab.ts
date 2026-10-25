'use client';

/**
 * Colaboración dentro del editor de Docs (tanda D3), separada de DocsEditor
 * para no mezclarla con el resto del editor:
 * - fusionar en vivo la versión de otra persona sin perder lo propio, el
 *   caret ni el deshacer (lib/docs-merge.ts);
 * - modo sugerir: lo que se tipea o se borra queda como sugerencia
 *   (lib/docs-marks.ts) hasta que alguien con edición la acepta;
 * - resaltados de comentarios sobre texto.
 */
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { DocsBlock } from '@/lib/docs-types';
import type { DocsHistory, DocsSnapshot } from '@/lib/docs-history';
import { mergeBlocks, mergeTitle } from '@/lib/docs-merge';
import {
  applySuggestEdit,
  flatText,
  hasSuggestions,
  resolveSuggestionHtml,
  stripComments,
  wrapComment as wrapCommentHtml,
} from '@/lib/docs-marks';
import { getSelectionOffsets, setCaretOffset } from '@/lib/docs-caret';
import { serializeEditable } from '@/lib/docs-richtext';

export type DocsEditorMode = 'edit' | 'suggest' | 'readonly';

export interface DocsEditorApi {
  /** Título y bloques tal como están en el editor ahora. */
  snapshot(): DocsSnapshot;
  /**
   * Fusiona la versión de otra persona (`remote`) con lo propio, a partir de
   * la última versión del servidor que vio este editor (`base`). Resuelve con
   * el resultado cuando ya está pintado.
   */
  mergeRemote(base: DocsSnapshot, remote: DocsSnapshot): Promise<{ merged: DocsSnapshot; conflicts: string[] }>;
  /** Descarta el guardado pendiente (se va a guardar lo fusionado). */
  cancelPendingSave(): void;
  hasPendingSave(): boolean;
  /** Resalta [start, end) del bloque para un comentario nuevo (id = anchor del hilo). */
  wrapComment(blockId: string, start: number, end: number, id: string): boolean;
  unwrapComment(id: string): void;
  /** Acepta o rechaza una sugerencia (o todas con id null). */
  resolveSuggestion(id: string | null, accept: boolean): void;
  /** Selección actual dentro de un bloque de texto (para comentar con ⌘⇧M). */
  selection(): { blockId: string; start: number; end: number; quote: string } | null;
}

interface Deps {
  mode: DocsEditorMode;
  userId: string | null;
  newId: () => string;
  live: MutableRefObject<DocsSnapshot>;
  lastSnap: MutableRefObject<DocsSnapshot | null>;
  historyRef: MutableRefObject<DocsHistory>;
  blockRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  setBlocksRaw: Dispatch<SetStateAction<DocsBlock[]>>;
  setTitle: Dispatch<SetStateAction<string>>;
  normalize: (blocks: DocsBlock[]) => DocsBlock[];
  triggerSave: (blocks?: DocsBlock[], title?: string) => void;
  saveTimeout: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingSave: MutableRefObject<(() => void) | null>;
  setDirty: (v: boolean) => void;
  apiRef?: MutableRefObject<DocsEditorApi | null>;
  rootRef: MutableRefObject<HTMLDivElement | null>;
  titleRef: MutableRefObject<HTMLDivElement | null>;
}

/** Lo que el efecto de historial necesita saber de una fusión remota en curso. */
export interface RemoteApply {
  prev: DocsSnapshot;
  caret: { blockId: string; start: number; end: number; text: string } | null;
  resolve: (r: { merged: DocsSnapshot; conflicts: string[] }) => void;
  conflicts: string[];
}

const HISTORY_REBASE = 50;

/** Nuevo offset del caret después de que cambió el texto del bloque por fuera. */
function shiftOffset(oldText: string, newText: string, offset: number): number {
  if (oldText === newText) return offset;
  let p = 0;
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++;
  if (offset <= p) return offset;
  return Math.max(p, Math.min(newText.length, offset + (newText.length - oldText.length)));
}

export function useDocsCollab(d: Deps) {
  const remote = useRef<RemoteApply | null>(null);
  const composing = useRef(false);
  const lastInputType = useRef<string>('');
  const depsRef = useRef(d);
  depsRef.current = d;

  /**
   * El efecto de historial de DocsEditor llama a esto antes de registrar un
   * paso: si el cambio vino de una fusión remota, no es un paso propio (no se
   * deshace) y el historial se rebasa con lo que trajo la otra persona.
   */
  const consumeRemote = useCallback((next: DocsSnapshot): boolean => {
    const r = remote.current;
    if (!r) return false;
    remote.current = null;
    const { historyRef, lastSnap, blockRefs } = depsRef.current;
    const rebase = (s: DocsSnapshot): DocsSnapshot => ({
      title: mergeTitle(r.prev.title, s.title, next.title),
      blocks: mergeBlocks(r.prev.blocks, s.blocks, next.blocks).blocks,
    });
    const h = historyRef.current;
    historyRef.current = {
      past: h.past.slice(-HISTORY_REBASE).map(rebase),
      future: h.future.slice(0, HISTORY_REBASE).map(rebase),
      typing: h.typing,
    };
    lastSnap.current = next;
    // Caret: si el bloque donde se escribe cambió, se corre según lo que se insertó antes.
    if (r.caret) {
      const i = next.blocks.findIndex((b) => b.id === r.caret!.blockId);
      const el = i >= 0 ? blockRefs.current[i] : null;
      const text = i >= 0 ? flatText(next.blocks[i].content) : '';
      if (el && text !== r.caret.text) {
        const off = shiftOffset(r.caret.text, text, r.caret.end);
        el.focus();
        setCaretOffset(el, off);
      }
    }
    r.resolve({ merged: next, conflicts: r.conflicts });
    return true;
  }, []);

  const api: DocsEditorApi = {
    snapshot: () => depsRef.current.live.current,
    mergeRemote: (base, theirs) =>
      new Promise((resolve) => {
        const { live, blockRefs, setBlocksRaw, setTitle, normalize, titleRef } = depsRef.current;
        const prev = live.current;
        // Una fusión anterior todavía sin pintar: se da por terminada (nadie queda esperando).
        if (remote.current) {
          remote.current.resolve({ merged: prev, conflicts: remote.current.conflicts });
          remote.current = null;
        }
        const active = document.activeElement as HTMLElement | null;
        const idx = active ? blockRefs.current.findIndex((el) => el === active) : -1;
        const sel = idx >= 0 && active ? getSelectionOffsets(active) : null;
        const caretBlock = idx >= 0 ? prev.blocks[idx] : undefined;
        const merged = mergeBlocks(base.blocks, prev.blocks, theirs.blocks);
        const blocks = normalize(merged.blocks);
        const title = mergeTitle(base.title, prev.title, theirs.title);
        const same = JSON.stringify(blocks) === JSON.stringify(prev.blocks) && title === prev.title;
        if (same) {
          resolve({ merged: prev, conflicts: merged.conflicts });
          return;
        }
        const entry: RemoteApply = {
          prev,
          caret: caretBlock && sel ? { blockId: caretBlock.id, start: sel.start, end: sel.end, text: flatText(caretBlock.content) } : null,
          resolve,
          conflicts: merged.conflicts,
        };
        remote.current = entry;
        // Red de seguridad: si por algo no se pintó, no deja a nadie esperando.
        setTimeout(() => {
          if (remote.current !== entry) return;
          remote.current = null;
          resolve({ merged: depsRef.current.live.current, conflicts: merged.conflicts });
        }, 2000);
        // El título editable solo se reescribe si no se está escribiendo en él.
        if (title !== prev.title && titleRef.current && document.activeElement !== titleRef.current) {
          titleRef.current.textContent = title;
        }
        setTitle(title);
        setBlocksRaw(blocks);
      }),
    cancelPendingSave: () => {
      const { saveTimeout, pendingSave, setDirty } = depsRef.current;
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
      pendingSave.current = null;
      setDirty(false);
    },
    hasPendingSave: () => depsRef.current.pendingSave.current !== null,
    wrapComment: (blockId, start, end, id) => {
      const { live, setBlocksRaw, triggerSave } = depsRef.current;
      const blocks = live.current.blocks;
      const i = blocks.findIndex((b) => b.id === blockId);
      if (i < 0) return false;
      const html = wrapCommentHtml(blocks[i].content, start, end, id);
      if (html === blocks[i].content) return false;
      const next = blocks.map((b, k) => (k === i ? { ...b, content: html } : b));
      setBlocksRaw(next);
      triggerSave(next);
      return true;
    },
    unwrapComment: (id) => {
      const { live, setBlocksRaw, triggerSave } = depsRef.current;
      const blocks = live.current.blocks;
      let changed = false;
      const next = blocks.map((b) => {
        if (!b.content?.includes(`data-comment="${id}"`)) return b;
        changed = true;
        return { ...b, content: stripComments(b.content, id) };
      });
      if (!changed) return;
      setBlocksRaw(next);
      triggerSave(next);
    },
    resolveSuggestion: (id, accept) => {
      const { live, setBlocksRaw, triggerSave, normalize } = depsRef.current;
      const match = (s: { id: string } | null | undefined) => !!s && (id === null || s.id === id);
      const next = normalize(
        live.current.blocks
          .filter((b) => !(match(b.suggestion) && !accept))
          .map((b) => {
            let out = b;
            if (match(b.suggestion)) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { suggestion: _s, ...rest } = b;
              out = rest;
            }
            if (out.content && hasSuggestions(out.content)) {
              out = { ...out, content: resolveSuggestionHtml(out.content, accept, id ?? undefined) };
            }
            return out;
          }),
      );
      setBlocksRaw(next);
      triggerSave(next);
    },
    selection: () => {
      const { live } = depsRef.current;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const node = sel.getRangeAt(0).commonAncestorContainer;
      const host = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest('.docs-editable');
      const anchor = host?.closest('[data-block-anchor]')?.getAttribute('data-block-anchor');
      if (!host || !anchor) return null;
      const off = getSelectionOffsets(host as HTMLElement);
      const block = live.current.blocks.find((b) => b.id === anchor);
      if (!off || !block || off.end <= off.start) return null;
      return { blockId: anchor, start: off.start, end: off.end, quote: flatText(block.content).slice(off.start, off.end) };
    },
  };
  if (d.apiRef) d.apiRef.current = api;

  // Modo sugerir: qué tipo de input fue (Supr deja el caret después de lo
  // tachado) y composición (acentos, IME): el cambio se procesa al terminar.
  useEffect(() => {
    const root = d.rootRef.current;
    if (!root) return;
    const onBefore = (e: InputEvent) => {
      lastInputType.current = e.inputType;
      if (depsRef.current.mode !== 'suggest') return;
      // Formato, soltar archivos o texto arrastrado: no se sugieren.
      if (/^format|^insertFromDrop$|^deleteByDrag$|^insertLink$/.test(e.inputType)) e.preventDefault();
    };
    const onStart = () => {
      composing.current = true;
    };
    root.addEventListener('beforeinput', onBefore);
    root.addEventListener('compositionstart', onStart);
    return () => {
      root.removeEventListener('beforeinput', onBefore);
      root.removeEventListener('compositionstart', onStart);
    };
  }, [d.rootRef]);

  /**
   * Cambio de texto en modo sugerir: el navegador ya lo aplicó en el DOM; se
   * rehace como sugerencia sobre el modelo. Devuelve el bloque nuevo y dónde
   * va el caret, o null si no hay que hacer nada (composición en curso).
   */
  const suggestChange = useCallback(
    (block: DocsBlock, nextHtml: string, el: HTMLElement | null): { content: string; caret: number } | null => {
      const { userId, newId } = depsRef.current;
      if (composing.current || !userId) return null;
      // Bloque sugerido entero: se escribe libre adentro.
      if (block.suggestion) return { content: nextHtml, caret: el ? getSelectionOffsets(el)?.end ?? 0 : 0 };
      const res = applySuggestEdit(block.content, nextHtml, userId, newId, { forward: /Forward$/.test(lastInputType.current) });
      if (!res.changed && el) {
        // Borrar algo ya tachado: no cambia nada; el DOM vuelve al modelo.
        el.innerHTML = block.content;
        setCaretOffset(el, res.caret);
        return null;
      }
      return { content: res.html, caret: res.caret };
    },
    [],
  );

  /** Fin de una composición (acento, IME): se procesa el texto final. */
  const onCompositionEnd = useCallback((index: number, apply: (index: number, content: string, caret: number) => void) => {
    composing.current = false;
    const { live, blockRefs, mode } = depsRef.current;
    if (mode !== 'suggest') return;
    const el = blockRefs.current[index];
    const block = live.current.blocks[index];
    if (!el || !block) return;
    const res = suggestChange(block, serializeEditable(el), el);
    if (res) apply(index, res.content, res.caret);
  }, [suggestChange]);

  return { consumeRemote, remote, suggestChange, onCompositionEnd, composing, lastInputType };
}
