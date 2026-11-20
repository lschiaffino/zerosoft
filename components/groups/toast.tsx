'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

/** Aviso corto abajo a la derecha (se va solo). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Aviso corto abajo. Con `action` (por ejemplo "Deshacer") dura más y trae su botón. */
export function useToast(): [ReactNode, (msg: string, bad?: boolean, action?: ToastAction) => void] {
  const [toast, setToast] = useState<{ msg: string; bad: boolean; action?: ToastAction } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.action ? 8000 : 3500);
    return () => clearTimeout(id);
  }, [toast]);
  const node = (
    <div className="ui-toasts" role="status" aria-live="polite">
      {toast && (
        <div className="ui-toast" data-tone={toast.bad ? 'error' : undefined}>
          {toast.msg}
          {toast.action && (
            <button
              type="button"
              className="ui-toast-action"
              onClick={() => {
                const act = toast.action;
                setToast(null);
                act?.onClick();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
  const show = useCallback((msg: string, bad = false, action?: ToastAction) => setToast({ msg, bad, action }), []);
  return [node, show];
}
