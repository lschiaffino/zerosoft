'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * "Reportar" del menú de un mensaje recibido, como en WhatsApp: confirma y,
 * en el mismo paso, deja bloquear al contacto (chat 1:1) o salir del grupo.
 * El texto dice lo que pasa de verdad: el reporte queda en el chat, no llega
 * a WhatsApp (el servidor de la línea no lo expone). Lo comparten Lines e Inbox.
 *
 * El mismo modal que ConfirmDialog (<dialog class="ui-modal ui-confirm">: Esc y
 * el telón cancelan, el foco arranca en Cancelar porque es destructivo), con la
 * casilla adentro del giro del Tab.
 */
export default function ReportDialog({
  open,
  name,
  extra,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Quién (para "Bloquear también a <nombre>"). */
  name: string;
  /** La casilla que va: bloquear (chat 1:1), salir (grupo) o ninguna (ya bloqueado, ya fuera, sin proveedor que lo haga). */
  extra: 'block' | 'leave' | null;
  busy?: boolean;
  onConfirm: (opts: { block: boolean; leave: boolean }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('groups.wa.report');
  const tc = useTranslations('groups.common');
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [checked, setChecked] = useState(false);
  // Al cerrar la casilla vuelve a desmarcarse: la próxima vez arranca sin marcar, como WhatsApp.
  const cancel = () => {
    setChecked(false);
    onCancel();
  };
  const confirm = () => {
    setChecked(false);
    onConfirm({ block: extra === 'block' && checked, leave: extra === 'leave' && checked });
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancelRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ui-modal ui-confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="report-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) cancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) cancel();
      }}
      onKeyDown={(e) => {
        // Foco atrapado entre la casilla y los dos botones.
        if (e.key !== 'Tab') return;
        const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])') ?? []);
        if (all.length === 0) return;
        const first = all[0];
        const last = all[all.length - 1];
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={titleId}>
              {t('title')}
            </h2>
          </div>
          <div className="ui-modal-body wa-report-body">
            <p id={bodyId}>{t('body')}</p>
            {extra && (
              <label className="gr-check-label">
                <input type="checkbox" className="ui-check" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} data-testid={`report-${extra}`} />
                {extra === 'block' ? t('block', { name }) : t('leave')}
              </label>
            )}
          </div>
          <div className="ui-modal-foot">
            <button ref={cancelRef} type="button" className="btn btn-sm" data-testid="report-cancel" onClick={cancel} disabled={busy}>
              {tc('cancel')}
            </button>
            <button
              type="button"
              data-testid="report-confirm"
              className="btn btn-sm btn-primary btn-danger"
              onClick={confirm}
              aria-busy={busy}
              disabled={busy}
            >
              {t('action')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
