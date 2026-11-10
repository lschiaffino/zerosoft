'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ComposeChange } from '@/lib/ai-compose';
import { composeReducer, initialCompose, requestFromPrompt, type ComposeRequest, type ComposeState } from './compose-machine';

export type ComposeResult = { ok: true; text: string; sources?: string[] } | { ok: false; code: string };

/**
 * Lo propio de cada producto: a qué ruta pedir y con qué contexto. La barra
 * no sabe de chats ni de hilos.
 */
export interface ComposeAdapter {
  /**
   * Pide el texto. `onText` recibe el texto entero hasta el momento, si la
   * ruta lo manda de a pedazos (Inbox); si no, no se llama (Lines). Nunca
   * lanza: devuelve el texto o el código de error. Corta con `signal`.
   */
  run(request: ComposeRequest, onText: (partial: string) => void, signal: AbortSignal): Promise<ComposeResult>;
  /** Hay una conversación a la que responder: se ofrece "Sugerir una respuesta". */
  canSuggest?: boolean;
  /** Idiomas a los que se puede traducir el texto. Sin lista, no se ofrece. */
  languages?: Array<{ code: string; label: string }>;
}

export interface AiCompose {
  open: boolean;
  state: ComposeState;
  /** Lo escrito en el campo de la barra. */
  prompt: string;
  setPrompt: (v: string) => void;
  /** Texto del composer en este momento (lo que se mejora si no hay borrador). */
  composerText: string;
  adapter: ComposeAdapter;
  /** Texto que había en el composer antes de insertar; null si no hay nada que deshacer. */
  undo: string | null;
  openBar: () => void;
  /** Cierra la barra y devuelve el foco al composer. El borrador a medio revisar queda para la próxima. */
  close: () => void;
  toggle: () => void;
  /** Enter en el campo: escribe el mensaje descripto, o aplica el cambio descripto. */
  submit: () => void;
  /** Sin instrucción: la respuesta al último mensaje. */
  suggest: () => void;
  refine: (change: ComposeChange) => void;
  translate: (to: string) => void;
  /** Otra versión del mismo pedido (reemplaza la que se ve). */
  regenerate: () => void;
  back: () => void;
  discard: () => void;
  /** Corta el pedido en curso. */
  cancel: () => void;
  /** Pone el borrador en el composer (nunca manda) y guarda lo que había para deshacer. */
  insert: () => void;
  undoInsert: () => void;
  /** Lo llama el composer al mandar: ya no hay nada que deshacer. */
  clearUndo: () => void;
}

/**
 * Estado de "Ayudame a escribir" para un composer. El composer le pasa su
 * texto y cómo cambiarlo; el hook nunca manda nada: como mucho reemplaza el
 * texto del composer, y recuerda el anterior para deshacer.
 */
export function useAiCompose(opts: {
  adapter: ComposeAdapter;
  text: string;
  setText: (v: string) => void;
  focusComposer: () => void;
  /** Cambia cuando el composer pasa a otra conversación: se cierra y se olvida todo. */
  resetKey?: string;
}): AiCompose {
  const [state, dispatch] = useReducer(composeReducer, initialCompose);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [undo, setUndo] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const runs = useRef(0);
  /** La descripción del mensaje, para devolverla al campo si se descarta el borrador. */
  const described = useRef('');
  // Lo último que pasó el composer y el último estado, para los handlers (que no se rearman en cada tecla).
  const live = useRef(opts);
  const stateRef = useRef(state);
  useEffect(() => {
    live.current = opts;
    stateRef.current = state;
  });

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);

  // Otra conversación: nada de la anterior sigue (ni el pedido en curso, ni el borrador, ni el deshacer).
  useEffect(() => {
    stop();
    dispatch({ type: 'discard' });
    setOpen(false);
    setPrompt('');
    setUndo(null);
    described.current = '';
  }, [opts.resetKey, stop]);
  // El composer se va: se corta el pedido en curso.
  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (request: ComposeRequest, replace = false) => {
      stop();
      const ctl = new AbortController();
      abort.current = ctl;
      const id = ++runs.current;
      dispatch({ type: 'start', run: id, request, replace });
      const res = await live.current.adapter.run(request, (text) => dispatch({ type: 'chunk', run: id, text }), ctl.signal);
      if (ctl.signal.aborted) return false;
      if (abort.current === ctl) abort.current = null;
      if (res.ok) dispatch({ type: 'done', run: id, text: res.text, sources: res.sources });
      else dispatch({ type: 'fail', run: id, code: res.code });
      return res.ok && res.text.trim() !== '';
    },
    [stop],
  );

  const submit = useCallback(() => {
    if (stateRef.current.phase === 'working') return;
    const ask = prompt.trim();
    const request = requestFromPrompt(stateRef.current, live.current.text, ask);
    if (!request) return;
    if (request.kind === 'draft') described.current = ask;
    void run(request).then((ok) => {
      // Salió bien: el campo queda libre para describir un cambio. Si falló, lo escrito sigue ahí para reintentar.
      if (ok) setPrompt('');
    });
  }, [prompt, run]);

  const suggest = useCallback(() => {
    if (stateRef.current.phase === 'working') return;
    described.current = '';
    void run({ kind: 'draft', instruction: '' });
  }, [run]);

  const refine = useCallback(
    (change: ComposeChange) => {
      // Sobre el borrador a la vista o, si no hay, sobre lo escrito en el composer.
      const text = stateRef.current.current?.text ?? live.current.text.trim();
      if (!text || stateRef.current.phase === 'working') return;
      void run({ kind: 'rewrite', text, change });
    },
    [run],
  );

  const translate = useCallback(
    (to: string) => {
      const text = stateRef.current.current?.text ?? live.current.text.trim();
      if (!text || !to || stateRef.current.phase === 'working') return;
      void run({ kind: 'translate', text, to });
    },
    [run],
  );

  const regenerate = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'review' || !s.current) return;
    void run(s.current.request, true);
  }, [run]);

  const cancel = useCallback(() => {
    stop();
    dispatch({ type: 'cancel' });
  }, [stop]);

  const discard = useCallback(() => {
    stop();
    dispatch({ type: 'discard' });
    setPrompt(described.current);
  }, [stop]);

  const close = useCallback(() => {
    stop();
    dispatch({ type: 'cancel' });
    setOpen(false);
    live.current.focusComposer();
  }, [stop]);

  const openBar = useCallback(() => setOpen(true), []);

  const insert = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'review' || !s.current) return;
    const before = live.current.text;
    live.current.setText(s.current.text);
    setUndo(before);
    dispatch({ type: 'discard' });
    setPrompt('');
    described.current = '';
    setOpen(false);
    // Después del render, para que el foco caiga en el campo ya con el texto.
    requestAnimationFrame(() => live.current.focusComposer());
  }, []);

  const undoInsert = useCallback(() => {
    if (undo === null) return;
    live.current.setText(undo);
    setUndo(null);
    live.current.focusComposer();
  }, [undo]);

  const clearUndo = useCallback(() => setUndo(null), []);

  return {
    open,
    state,
    prompt,
    setPrompt,
    composerText: opts.text,
    adapter: opts.adapter,
    undo,
    openBar,
    close,
    toggle: () => (open ? close() : openBar()),
    submit,
    suggest,
    refine,
    translate,
    regenerate,
    back: () => dispatch({ type: 'back' }),
    discard,
    cancel,
    insert,
    undoInsert,
    clearUndo,
  };
}
