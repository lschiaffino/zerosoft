'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useBackLayer } from './backLayer';

/** Algo abierto encima del chat (un diálogo, un menú, el visor): Esc es de eso, no de la selección. */
const OVERLAY = 'dialog[open], [role="dialog"]:not(dialog):not([hidden]), [role="alertdialog"]:not(dialog), [role="menu"], .wa-viewer';

interface State {
  ids: Set<string>;
  /** Se entró con "Reenviar": solo se eligen mensajes que se pueden reenviar. */
  forward: boolean;
}

/**
 * Elegir mensajes de una conversación (Lines e Inbox), como WhatsApp: "Reenviar" o "Seleccionar" en un mensaje
 * entra al modo con ese mensaje elegido; tocar otro lo suma o lo saca; Esc, la X o "atrás" salen, y cambiar de
 * chat (`resetKey`) también. Al entrar con "Reenviar" el foco va a la casilla de ese mensaje; al salir, al campo
 * de texto.
 */
export function useMessageSelection(opts: {
  /** El chat abierto: al cambiar se sale del modo. */
  resetKey: string;
  /** La caja de los mensajes (para llevar el foco a la casilla y de vuelta al campo). */
  box: RefObject<HTMLElement | null>;
  /** Si ese mensaje se puede elegir; con `forward`, además tiene que poder reenviarse. */
  canPick: (id: string, forward: boolean) => boolean;
}) {
  const [state, setState] = useState<State | null>(null);
  const canPick = useRef(opts.canPick);
  canPick.current = opts.canPick;
  const box = opts.box;
  /** Qué enfocar cuando el cambio de estado ya esté en pantalla. */
  const focusNext = useRef<{ check: string } | 'composer' | null>(null);

  const exit = useCallback(() => {
    setState((prev) => {
      if (prev) focusNext.current = 'composer';
      return null;
    });
  }, []);
  /** Como el estado de antes: un conjunto (vacío incluido) entra o sigue en el modo; null sale. */
  const setSelecting = useCallback((ids: Set<string> | null) => {
    setState((prev) => {
      if (!ids && prev) focusNext.current = 'composer';
      return ids ? { ids, forward: prev?.forward ?? false } : null;
    });
  }, []);
  const startForward = useCallback((id: string) => {
    focusNext.current = { check: id };
    setState({ ids: new Set(canPick.current(id, true) ? [id] : []), forward: true });
  }, []);
  const toggle = useCallback((id: string) => {
    setState((prev) => {
      if (!prev || !canPick.current(id, prev.forward)) return prev;
      const ids = new Set(prev.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      // En el teléfono, como WhatsApp: sacar el último elegido sale del modo (en la computadora queda "0 elegidos").
      if (!ids.size && window.matchMedia('(hover: none)').matches) {
        focusNext.current = 'composer';
        return null;
      }
      return { ...prev, ids };
    });
  }, []);

  useBackLayer(!!state, () => setState(null));

  // Otro chat: se sale sin mover el foco.
  useEffect(() => {
    focusNext.current = null;
    setState(null);
  }, [opts.resetKey]);

  const on = !!state;
  useEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    if (!want) return;
    if (want === 'composer') {
      // En el teléfono enfocar el campo abre el teclado: ahí el foco se queda donde está.
      if (!window.matchMedia('(hover: none)').matches) box.current?.closest('.gr-thread')?.querySelector<HTMLElement>('.wa-input')?.focus({ preventScroll: true });
      return;
    }
    const el = [...(box.current?.querySelectorAll<HTMLElement>('[data-select-id]') ?? [])].find((x) => x.dataset.selectId === want.check);
    el?.focus({ preventScroll: true });
  }, [on, box]);

  useEffect(() => {
    if (!on) return;
    // En captura: antes que los atajos de la pantalla (que con Esc cierran el chat).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[role="dialog"], [role="menu"], [role="alertdialog"]') || document.querySelector(OVERLAY)) return;
      e.preventDefault();
      e.stopPropagation();
      exit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [on, exit]);

  return {
    /** Los elegidos, o null fuera del modo. */
    selecting: state?.ids ?? null,
    forwardOnly: state?.forward ?? false,
    /** Si en este modo ese mensaje se puede elegir. */
    canPick: (id: string) => !!state && opts.canPick(id, state.forward),
    setSelecting,
    startForward,
    toggle,
    exit,
  };
}

/** La casilla de un mensaje en modo selección: un control de verdad (Tab llega, Espacio lo marca), con su nombre. */
export function SelectCheck({ id, checked, label, preview, onToggle }: { id: string; checked: boolean; label: string; preview?: string; onToggle: (id: string) => void }) {
  const text = preview?.replace(/\s+/g, ' ').trim().slice(0, 80);
  return (
    <input
      type="checkbox"
      className="wa-select-check"
      data-select-id={id}
      checked={checked}
      aria-label={text ? `${label}: ${text}` : label}
      onChange={() => onToggle(id)}
      // El clic no sube al mensaje, que también lo alterna.
      onClick={(e) => e.stopPropagation()}
    />
  );
}
