'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Foco en un campo editable o en un diálogo abierto: los atajos de una tecla no corren. */
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return (
    node.isContentEditable ||
    Boolean(node.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"], [role="menu"], [role="listbox"]'))
  );
}

/**
 * Atajos de la lista de links (como Dub y Linear): "/" enfoca la búsqueda y
 * "?" abre la ayuda con todos los atajos. "C" (nuevo link) lo maneja
 * LinksQuickCreate; acá solo se lista.
 */
export default function LinkListShortcuts() {
  const t = useTranslations('link');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (e.key === '/') {
        const input = document.querySelector<HTMLInputElement>('[data-links-search]');
        if (!input) return;
        e.preventDefault();
        input.focus();
        input.select();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const rows: Array<{ keys: string; label: string }> = [
    { keys: 'c', label: t('shortcuts.newLink') },
    { keys: '/', label: t('shortcuts.search') },
    { keys: 'esc', label: t('shortcuts.clearSearch') },
    { keys: '?', label: t('shortcuts.help') },
    { keys: '⌘k', label: t('shortcuts.commandMenu') },
  ];

  return (
    <dialog
      ref={ref}
      className="ui-modal lk-shortcuts"
      aria-labelledby="lk-shortcuts-title"
      data-testid="links-shortcuts"
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id="lk-shortcuts-title">
              {t('shortcuts.title')}
            </h2>
          </div>
          <div className="ui-modal-body">
            <dl className="lk-shortcuts-list">
              {rows.map((r) => (
                <div key={r.keys} className="lk-shortcuts-row">
                  <dt>{r.label}</dt>
                  <dd>
                    <kbd className="kbd">{r.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" autoFocus onClick={() => setOpen(false)}>
              {t('common.close')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
