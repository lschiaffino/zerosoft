"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WhenMode } from "@/lib/when-presets";
import WhenPicker, { whenShortcut } from "./WhenPicker";

export interface WhenLabels {
  /** Botón de la fecha elegida a mano ("Programar", "Posponer"). */
  confirm: string;
  cancel: string;
}

/**
 * Elegir cuándo: posponer, recordar o programar un envío. Las opciones del
 * momento con atajos 1, 2, 3… (como Superhuman) y "Elegir día y hora" con un
 * calendario y una hora (components/ui/WhenPicker). Esc o el telón cierran.
 * Lo usan Inbox y Lines: cada uno pasa sus textos (`labels`), el modo
 * (`snooze` o `send`, cambia las opciones) y, si quiere, una nota arriba
 * (`help`) y algo más en el pie (`extra`, por ejemplo "Repetir").
 */
export default function WhenDialog({
  open,
  title,
  mode = "snooze",
  labels,
  help,
  extra,
  initial,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  mode?: WhenMode;
  labels: WhenLabels;
  help?: ReactNode;
  extra?: ReactNode;
  /** Fecha con la que arranca el calendario (al cambiar la hora de algo ya programado). */
  initial?: string | null;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(() => new Date());
  // Al abrir, "ahora" se toma en el mismo render (no en un efecto): el selector se dibuja una vez, con las opciones de este momento.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNow(new Date());
  }

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal enfoca lo primero que encuentra: el foco va a la primera opción.
      d.querySelector<HTMLElement>(".ui-when-opt")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ui-modal ui-when"
      aria-label={open ? title : ""}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => void whenShortcut(e)}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
          </div>
          <div className="ui-modal-body ui-when-body">
            {help && <div className="ui-help ui-when-help">{help}</div>}
            <WhenPicker
              key={now.getTime()}
              mode={mode}
              now={now}
              initial={initial}
              confirmLabel={labels.confirm}
              onPick={onPick}
            />
          </div>
          <div className="ui-modal-foot">
            {extra}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
            >
              {labels.cancel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
