'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Playbook, PlaybookEntity } from '@/lib/crm-playbooks-schema';
import PlaybookRunner, { type PlaybookCallDraft } from './PlaybookRunner';

/** Cache por página de los playbooks de cada tipo de registro. */
const cache = new Map<PlaybookEntity, Promise<Playbook[] | null>>();
export function loadPlaybooks(entity: PlaybookEntity, fresh = false): Promise<Playbook[] | null> {
  if (fresh || !cache.has(entity)) {
    cache.set(
      entity,
      fetch(`/api/crm/playbooks?entity=${entity}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: Playbook[] }>) : null))
        .then((d) => d?.rows ?? null)
        .catch(() => {
          cache.delete(entity);
          return null;
        }),
    );
  }
  return cache.get(entity)!;
}

interface PlaybookLauncherProps {
  entity: PlaybookEntity;
  entityId: string;
  values?: Record<string, string>;
  /** Abre el playbook como parte de una llamada (PhoneTouch). */
  call?: PlaybookCallDraft;
  /** Botón chico (dentro del registro de llamada). */
  compact?: boolean;
  onSaved?: () => void;
}

/**
 * Botón "Playbooks" del registro: lista los playbooks que aplican y abre el
 * elegido en el drawer. Teclado: flechas recorren el menú, Esc lo cierra.
 */
export default function PlaybookLauncher({ entity, entityId, values, call, compact = false, onSaved }: PlaybookLauncherProps) {
  const t = useTranslations('crm');
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Playbook[] | null | undefined>(undefined);
  const [active, setActive] = useState<Playbook | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setList(undefined);
    void loadPlaybooks(entity, true).then(setList);
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, entity]);

  useEffect(() => {
    if (open && list) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, list]);

  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(idx + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(idx - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div className="record-more pb-launcher">
      <button
        ref={buttonRef}
        type="button"
        className={compact ? 'btn btn-ghost btn-small' : 'btn btn-secondary btn-sm'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid="playbook-launcher"
      >
        {t('playbooks.launch')}
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" className="record-more-menu pb-menu" aria-label={t('playbooks.launch')} onKeyDown={onMenuKey}>
          {list === undefined && <p className="muted pb-menu-note">{t('playbooks.loading')}</p>}
          {list === null && <p className="form-error pb-menu-note">{t('playbooks.loadError')}</p>}
          {list && list.length === 0 && (
            <p className="muted pb-menu-note">
              {t('playbooks.noneForRecord')}{' '}
              <Link href="/app/crm/playbooks" role="menuitem">
                {t('playbooks.manage')}
              </Link>
            </p>
          )}
          {list?.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="record-more-item"
              onClick={() => {
                setOpen(false);
                setActive(p);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      {active && (
        <PlaybookRunner
          playbook={active}
          entity={entity}
          entityId={entityId}
          values={values}
          call={call}
          onSaved={onSaved}
          onClose={() => {
            setActive(null);
            buttonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
