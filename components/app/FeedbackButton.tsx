'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import FeedbackForm from '@/components/FeedbackForm';
import { productFromPath } from '@/lib/feedback-constants';
import Icon from './icons';

/**
 * Entrada "Feedback" del pie del sidebar. Abre un modal (portal al body: el
 * drawer mobile tiene transform y rompería el position:fixed).
 */
export default function FeedbackButton({ email }: { email: string }) {
  const t = useTranslations('feedback');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="side-link" title={t('entry')} onClick={() => setOpen(true)}>
        <Icon name="feedback" />
        {t('entry')}
      </button>
      {open &&
        createPortal(
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fb-modal-title"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="modal-card fb-modal">
              <div className="fb-modal-head">
                <div>
                  <h2 className="modal-title" id="fb-modal-title">
                    {t('form.title')}
                  </h2>
                  <p className="fb-modal-sub">{t('form.sub')}</p>
                </div>
                <button type="button" className="fb-modal-x" onClick={() => setOpen(false)} aria-label={t('form.close')}>
                  ✕
                </button>
              </div>
              <FeedbackForm
                defaultProduct={productFromPath(pathname)}
                signedInEmail={email}
                onDone={() => setOpen(false)}
                onCancel={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
