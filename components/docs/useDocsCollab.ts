'use client';

/**
 * Colaboración dentro del editor de Docs (tanda D3), separada de DocsEditor
 * para no mezclarla con el resto del editor:
 * - sumar a la pantalla lo que cambió en el servidor (la respuesta
 *   fusionada de un guardado o la versión de otra persona que trae el pulso
 *   en vivo) sin perder lo propio, el caret ni el deshacer (lib/docs-merge.ts,
 *   la misma fusión que hace el servidor);
 * - modo sugerir: lo que se tipea o se borra queda como sugerencia
 *   (lib/docs-marks.ts) hasta que alguien con edición la acepta;
 * - resaltados de comentarios sobre texto.
 */
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { DocsBlock } from '@/lib/docs-types';
import { rebaseHistoryText, rebaseSnapshotText, type DocsHistory, type DocsSnapshot, type DocsTextSteps } from '@/lib/docs-history';
import { mergeBlocksDetailed, mergeTitle, sameContent } from '@/lib/docs-merge';
import {
  applySuggestEdit,
  flatText,
  hasSuggestions,
  resolveSuggestionHtml,
  stripComments,
  wrapComment as wrapCommentHtml,
} from '@/lib/docs-marks';
import { getSelectionOffsets, setCaretOffset, setSelectionOffsets } from '@/lib/docs-caret';
import { serializeEditable } from '@/lib/docs-richtext';
import { htmlIndexOf, textOffsetOf, transformTextOffset, type TextOp } from '@/lib/docs-ot';
import type { RemapCaret, RemapResult } from '@/lib/docs-coedit-remap';

export type DocsEditorMode = 'edit' | 'suggest' | 'readonly';

export interface DocsEditorApi {
  /** Título y bloques tal como están en el editor ahora. */
  snapshot(): DocsSnapshot;
  /**
   * Suma a la pantalla lo que cambió en el servidor entre `base` (lo que este
   * editor mandó o la última versión que vio) y `remote` (lo que quedó
   * guardado). Devuelve el resultado en el acto (ya puesto en el estado).
   */
  /** `caretOp` null: el caret ya quedó donde va (no se toca al pintar). */
  applyRemote(base: DocsSnapshot, remote: DocsSnapshot, caretOp?: RemoteApply['caretOp'] | null): { merged: DocsSnapshot; conflicts: string[]; changed: boolean };
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
  /** Texto (HTML-lite) de un bloque tal como está en el editor; null si no está. */
  blockText(blockId: string): string | null;
  /**
   * Pone el texto de un bloque que cambió otra persona (operación del feed en
   * vivo, lib/docs-coedit-client.ts): no es un paso propio del deshacer y el
   * caret se corre según `op` (que lleva de `prev` a `text`).
   */
  applyBlockText(changes: Record<string, string>, ops?: DocsTextSteps): void;
  /** Composición (acentos, IME) o tecla todavía sin pasar al modelo: lo remoto espera. */
  busy(): boolean;
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
  /** Edición simultánea: qué bloques viajan por operaciones y cómo reubicar lo propio al partir o unir. */
  coedit?: DocsCoeditStructure | null;
}

/** Lo que el editor necesita de la edición simultánea al fusionar estructura (lib/docs-coedit-client.ts). */
export interface DocsCoeditStructure {
  manages(id: string): boolean;
  remap(prev: DocsBlock[], theirs: DocsBlock[], merged: DocsBlock[], caret: RemapCaret | null): RemapResult<DocsBlock> | null;
}

/** Lo que el efecto de historial necesita saber de una fusión remota en curso. */
export interface RemoteApply {
  prev: DocsSnapshot;
  /** `exact`: el caret va a ese offset de ese bloque (lo propio pasó a otro bloque al partir o unir). */
  caret: { blockId: string; start: number; end: number; text: string; exact?: boolean; el?: HTMLElement | null } | null;
  /** El caret ya se puso (efecto de layout, antes de que llegue otra tecla). */
  caretDone?: boolean;
  /** Estructura fusionada (ids y tipos): el caret se pone recién cuando el render la muestra. */
  shape?: string;
  resolve: (r: { merged: DocsSnapshot; conflicts: string[] }) => void;
  conflicts: string[];
  /** Operaciones exactas sobre el bloque del caret (edición simultánea): corren el caret con precisión. */
  caretOp?: CaretOp;
}

/** Pasos (texto de antes y operación) por los que pasó un bloque: el caret se corre por cada uno. */
export interface CaretOp {
  blockId: string;
  steps: Array<{ op: TextOp; prev: string }>;
}

const HISTORY_REBASE = 50;
/** Ids y tipos de los bloques, en orden (la forma de la estructura). */
const blockShape = (blocks: DocsBlock[]) => blocks.map((b) => `${b.id}:${b.type}`).join('|');
/** Índice por id de cada lista de bloques (la edición simultánea lee bloques sueltos seguido). */
const blockIndex = new WeakMap<DocsBlock[], Map<string, DocsBlock>>();

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
  const lastInputAt = useRef(0);
  const depsRef = useRef(d);
  depsRef.current = d;

  /**
   * El efecto de historial de DocsEditor llama a esto antes de registrar un
   * paso: si el cambio vino de una fusión remota, no es un paso propio (no se
   * deshace) y el historial se rebasa con lo que trajo la otra persona.
   */
  /**
   * El caret después de pintar una fusión remota. Corre en un efecto de
   * layout (DocsEditor): antes de que el navegador entregue otra tecla, así
   * nada se escribe en un bloque que ya no está o en un offset viejo.
   */
  const restoreCaret = useCallback(() => {
    const r = remote.current;
    if (!r || r.caretDone || !r.caret) return;
    const { live, blockRefs } = depsRef.current;
    const next = live.current;
    // Un render anterior (una tecla en el medio) todavía no muestra la fusión: espera al siguiente.
    if (r.shape !== undefined && blockShape(next.blocks) !== r.shape) return;
    r.caretDone = true;
    const i = next.blocks.findIndex((b) => b.id === r.caret!.blockId);
    const el = i >= 0 ? blockRefs.current[i] : null;
    if (!el) return;
    if (r.caret.exact) {
      // Lo propio pasó a otro bloque (partir o unir): el caret va con eso.
      el.focus();
      setCaretOffset(el, r.caret.end);
    } else if (r.caretOp && r.caretOp.blockId === r.caret.blockId) {
      try {
        let start = r.caret.start;
        let end = r.caret.end;
        for (const step of r.caretOp.steps) {
          start = transformTextOffset(step.prev, start, step.op);
          end = transformTextOffset(step.prev, end, step.op);
        }
        if (document.activeElement !== el) el.focus();
        setSelectionOffsets(el, start, end);
      } catch {
        /* texto que no coincide: el caret queda donde lo dejó el navegador */
      }
    } else {
      const text = flatText(next.blocks[i].content);
      if (text !== r.caret.text) {
        el.focus();
        setCaretOffset(el, shiftOffset(r.caret.text, text, r.caret.end));
      } else if ((r.caret.el && r.caret.el !== el) || document.activeElement !== el) {
        // El bloque se volvió a crear (cambió el tipo, "# "): el caret vuelve a su lugar.
        el.focus();
        setCaretOffset(el, r.caret.end);
      }
    }
  }, []);

  /**
   * El efecto de historial de DocsEditor llama a esto antes de registrar un
   * paso: si el cambio vino de una fusión remota, no es un paso propio (no se
   * deshace). El historial ya se rebasó al llegar la fusión (applyRemote).
   */
  const consumeRemote = useCallback((next: DocsSnapshot): boolean => {
    const r = remote.current;
    if (!r) return false;
    restoreCaret();
    remote.current = null;
    depsRef.current.lastSnap.current = next;
    r.resolve({ merged: next, conflicts: r.conflicts });
    return true;
  }, [restoreCaret]);

  const api: DocsEditorApi = {
    snapshot: () => depsRef.current.live.current,
    blockText: (blockId) => {
      const list = depsRef.current.live.current.blocks;
      let index = blockIndex.get(list);
      if (!index) {
        index = new Map(list.map((x) => [x.id, x]));
        blockIndex.set(list, index);
      }
      const b = index.get(blockId);
      return b && typeof b.content === 'string' ? b.content : null;
    },
    busy: () => {
      if (composing.current) return true;
      const { live, blockRefs } = depsRef.current;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? blockRefs.current.findIndex((el) => el === active) : -1;
      if (idx < 0 || !active || Date.now() - lastInputAt.current > 400) return false;
      // Una tecla que el navegador ya pintó y el modelo todavía no tiene.
      return serializeEditable(active) !== (live.current.blocks[idx]?.content ?? '');
    },
    applyBlockText: (changes, ops = {}) => {
      const { live, blockRefs, setBlocksRaw, normalize, historyRef, lastSnap } = depsRef.current;
      const cur = live.current;
      if (!cur.blocks.some((b) => b.id in changes)) return;
      // El DOM se actualiza ya, no en el próximo render: una tecla que llegue en el
      // medio se escribe sobre el texto con lo de la otra persona (si no, la pisaba).
      cur.blocks.forEach((b, i) => {
        if (!(b.id in changes)) return;
        const el = blockRefs.current[i];
        if (!el || serializeEditable(el) !== (b.content ?? '')) return;
        const focused = document.activeElement === el;
        const sel = focused ? getSelectionOffsets(el) : null;
        el.innerHTML = changes[b.id];
        if (focused && sel) {
          let start = sel.start;
          let end = sel.end;
          try {
            for (const step of ops[b.id] ?? []) {
              start = transformTextOffset(step.prev, start, step.op);
              end = transformTextOffset(step.prev, end, step.op);
            }
          } catch {
            /* el caret queda en el mismo offset */
          }
          setSelectionOffsets(el, start, end);
        }
      });
      const byId = new Map(cur.blocks.map((b) => [b.id, b]));
      const blocks = normalize(cur.blocks.map((b) => (b.id in changes && b.content !== changes[b.id] ? { ...b, content: changes[b.id] } : b)));
      if (blocks.every((b) => byId.get(b.id) === b) && blocks.length === cur.blocks.length) return;
      // Deshacer solo deshace lo propio: cada foto del historial (y la última
      // registrada) suma lo ajeno transformando sus diferencias contra estas
      // operaciones. Lo propio que se escriba después se registra como siempre.
      historyRef.current = rebaseHistoryText(historyRef.current, ops);
      if (lastSnap.current) lastSnap.current = rebaseSnapshotText(lastSnap.current, ops);
      // El modelo ya es este (el render llega después): lo próximo que se lea lo ve.
      live.current = { title: cur.title, blocks };
      setBlocksRaw(blocks);
    },
    applyRemote: (base, theirs, caretOp?: RemoteApply['caretOp'] | null) => {
      const { live, blockRefs, setBlocksRaw, setTitle, normalize, titleRef } = depsRef.current;
      const prev = live.current;
      // Una fusión anterior todavía sin pintar: se da por terminada.
      if (remote.current) {
        remote.current.resolve({ merged: prev, conflicts: remote.current.conflicts });
        remote.current = null;
      }
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? blockRefs.current.findIndex((el) => el === active) : -1;
      const sel = idx >= 0 && active ? getSelectionOffsets(active) : null;
      const caretBlock = idx >= 0 ? prev.blocks[idx] : undefined;
      const byId = new Map(prev.blocks.map((b) => [b.id, b]));
      // El texto de los bloques que viajan por operaciones no cuenta en esta
      // fusión (llega por el feed): borrar uno gana aunque acá tenga texto
      // nuevo. Lo propio de ese texto lo reubica `remap`.
      const co = depsRef.current.coedit ?? null;
      const baseById = new Map(base.blocks.map((b) => [b.id, b]));
      const managed = (b: DocsBlock) => !!co && co.manages(b.id) && typeof b.content === 'string' && typeof baseById.get(b.id)?.content === 'string';
      const ours = co ? prev.blocks.map((b) => (managed(b) ? { ...b, content: baseById.get(b.id)!.content } : b)) : prev.blocks;
      const res = mergeBlocksDetailed(base.blocks, theirs.blocks, ours);
      let mergedBlocks = co
        ? res.blocks.map((b) => {
            const mine = byId.get(b.id);
            return mine && managed(mine) && typeof b.content === 'string' ? { ...b, content: mine.content } : b;
          })
        : res.blocks;
      // Partir o unir el bloque donde se escribía: lo propio va al bloque que corresponde.
      let exactCaret: RemoteApply['caret'] = null;
      if (co) {
        const caretAt: RemapCaret | null = caretBlock && sel && typeof caretBlock.content === 'string' ? { block: caretBlock.id, index: htmlIndexOf(caretBlock.content, sel.end) } : null;
        const moved = co.remap(prev.blocks, theirs.blocks, mergedBlocks, caretAt);
        if (moved) {
          mergedBlocks = moved.blocks;
          if (moved.caret && caretAt && moved.caret.block !== caretAt.block) {
            const target = mergedBlocks.find((b) => b.id === moved.caret!.block);
            const html = typeof target?.content === 'string' ? target.content : '';
            const off = textOffsetOf(html, moved.caret.index);
            exactCaret = { blockId: moved.caret.block, start: off, end: off, text: flatText(html), exact: true };
          }
        }
      }
      // Los bloques que no cambiaron quedan con el mismo objeto (no se repinta lo que se está escribiendo).
      const blocks = normalize(mergedBlocks.map((b) => {
        const old = byId.get(b.id);
        return old && sameContent(old, b) ? old : b;
      }));
      const title = mergeTitle(base.title, theirs.title, prev.title);
      const merged = { title, blocks };
      if (sameContent(blocks, prev.blocks) && title === prev.title) return { merged: prev, conflicts: res.conflicts, changed: false };
      // Cada foto del historial suma lo que trajo la fusión (deshacer no deshace
      // lo ajeno). Se hace ya, no al pintar: dos fusiones seguidas antes de un
      // render no pierden la primera.
      const rebase = (s: DocsSnapshot): DocsSnapshot => ({
        title: mergeTitle(prev.title, title, s.title),
        blocks: mergeBlocksDetailed(prev.blocks, blocks, s.blocks).blocks,
      });
      const { historyRef } = depsRef.current;
      const h = historyRef.current;
      historyRef.current = {
        past: h.past.slice(-HISTORY_REBASE).map(rebase),
        future: h.future.slice(0, HISTORY_REBASE).map(rebase),
        typing: h.typing,
      };
      const entry: RemoteApply = {
        prev,
        caret: exactCaret ?? (caretOp === null ? null : caretBlock && sel ? { blockId: caretBlock.id, start: sel.start, end: sel.end, text: flatText(caretBlock.content), el: active } : null),
        resolve: () => {},
        conflicts: res.conflicts,
        caretOp: caretOp ?? undefined,
        shape: blockShape(blocks),
      };
      remote.current = entry;
      // Red de seguridad: si por algo no se pintó, no queda marcada.
      setTimeout(() => {
        if (remote.current === entry) remote.current = null;
      }, 2000);
      // El título editable solo se reescribe si no se está escribiendo en él.
      if (title !== prev.title && titleRef.current && document.activeElement !== titleRef.current) {
        titleRef.current.textContent = title;
      }
      setTitle(title);
      setBlocksRaw(blocks);
      return { merged, conflicts: res.conflicts, changed: true };
    },
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
      lastInputAt.current = Date.now();
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

  return { api, consumeRemote, restoreCaret, remote, suggestChange, onCompositionEnd, composing, lastInputType };
}
