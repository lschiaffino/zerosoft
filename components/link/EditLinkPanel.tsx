'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { LinkDto } from '@/lib/links';
import EditLinkForm from './EditLinkForm';

/**
 * Edición de un link en un panel lateral (antes era un formulario largo al
 * pie del detalle). Se abre con el botón, con `?edit=1` (desde la tabla) o
 * con el ancla vieja `#edit`. Esc o el fondo cierran.
 */
export default function EditLinkPanel({ link }: { link: LinkDto }) {
  const t = useTranslations('link');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const fromQuery = searchParams.get('edit') === '1';
    if (fromQuery || window.location.hash === '#edit') {
      setOpen(true);
      if (fromQuery) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('edit');
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    }
  }, [searchParams, pathname, router]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const trigger = triggerRef.current;
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-small"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="link-edit-open"
      >
        {t('common.edit')}
      </button>
      {open && (
        <div className="link-drawer-overlay" onMouseDown={() => setOpen(false)}>
          <div
            ref={panelRef}
            className="link-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-drawer-title"
            onMouseDown={(e) => e.stopPropagation()}
            data-testid="link-edit-panel"
          >
            <div className="link-drawer-head">
              <p id="link-drawer-title" className="section-label">
                {t('detail.editTitle')}
              </p>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label={t('common.close')}>
                ✕
              </button>
            </div>
            <div className="link-drawer-body">
              <EditLinkForm link={link} onSaved={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
