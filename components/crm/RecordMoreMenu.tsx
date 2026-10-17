'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export interface RecordMoreItem {
  key: string;
  /** Texto del ítem del menú. */
  label: string;
  /** Título del panel que abre (por defecto, el label). */
  title?: string;
  content: ReactNode;
  /** "danger": va al final, separado, en rojo, y abre un modal en lugar del drawer. */
  tone?: 'default' | 'danger';
}

/**
 * Menú "Más" del detalle de un registro: lo que no se usa todos los días
 * (duplicados, historial, eliminar). Cada ítem abre su panel en un drawer
 * (o un modal si es destructivo). El contenido se monta recién al abrir, así
 * los paneles que piden datos (historial, duplicados) no cargan de entrada.
 *
 * Teclado: Enter/Espacio/flecha abajo abren el menú; flechas, Home y End
 * mueven el foco; Esc cierra y devuelve el foco al botón.
 */
export default function RecordMoreMenu({ items, label }: { items: RecordMoreItem[]; label?: string }) {
  const t = useTranslations('crm.record');
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<RecordMoreItem | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const ordered = [...items.filter((i) => i.tone !== 'danger'), ...items.filter((i) => i.tone === 'danger')];

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (active && dialog && !dialog.open) dialog.showModal();
  }, [active]);

  function closeDialog() {
    dialogRef.current?.close();
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const idx = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(idx + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(idx - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      setOpen(false);
      if (e.key === 'Escape') buttonRef.current?.focus();
    }
  }

  const danger = active?.tone === 'danger';
  const titleId = `${menuId}-title`;

  return (
    <div className="record-more">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        data-testid="record-more"
      >
        {label ?? t('moreLabel')}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" className="record-more-menu" aria-label={label ?? t('moreLabel')} onKeyDown={onMenuKey}>
          {ordered.map((item, i) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`record-more-item${item.tone === 'danger' ? ' is-danger' : ''}${
                item.tone === 'danger' && i > 0 ? ' has-rule' : ''
              }`}
              onClick={() => {
                setOpen(false);
                setActive(item);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {active && (
        <dialog
          ref={dialogRef}
          className={danger ? 'ui-modal' : 'ui-drawer'}
          aria-labelledby={titleId}
          onClose={() => {
            setActive(null);
            buttonRef.current?.focus();
          }}
          onClick={(e) => {
            // Clic en el telón (fuera de la caja) cierra.
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div className={danger ? 'ui-modal-head' : 'ui-drawer-head'}>
            <h2 id={titleId} className={danger ? 'ui-modal-title' : 'ui-drawer-title'}>
              {active.title ?? active.label}
            </h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={closeDialog} aria-label={t('close')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className={danger ? 'ui-modal-body' : 'ui-drawer-body'}>{active.content}</div>
        </dialog>
      )}
    </div>
  );
}
