'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import QuickLinkModal, { type CreatedLink } from './QuickLinkModal';

/** Evento para abrir el modal desde otros lugares de la página (empty state). */
export const OPEN_NEW_LINK_EVENT = 'zs:new-link';

interface LinksQuickCreateProps {
  domain: string;
  customDomains?: Array<{ id: string; hostname: string }>;
}

function looksLikeUrl(text: string): boolean {
  const v = text.trim();
  if (!v || /\s/.test(v) || v.length > 2000) return false;
  return /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Botón "Crear link" de la lista + modal de creación rápida. Atajos: "C" abre
 * el modal; pegar una URL en cualquier parte de la página (fuera de un campo)
 * lo abre con esa URL. Al crear, copia el link corto y lo muestra arriba.
 */
export default function LinksQuickCreate({ domain, customDomains }: LinksQuickCreateProps) {
  const t = useTranslations('link');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [initialUrl, setInitialUrl] = useState('');
  const [created, setCreated] = useState<{ link: CreatedLink; copied: boolean } | null>(null);

  const openWith = useCallback((url = '') => {
    setInitialUrl(url);
    setOpen(true);
  }, []);

  useKeyShortcut('c', () => openWith(), !open);

  useEffect(() => {
    const onOpen = () => openWith();
    const onPaste = (e: ClipboardEvent) => {
      if (open) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.closest('input, textarea, select, [contenteditable="true"]'))) return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (!looksLikeUrl(text)) return;
      e.preventDefault();
      openWith(text.trim());
    };
    window.addEventListener(OPEN_NEW_LINK_EVENT, onOpen);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener(OPEN_NEW_LINK_EVENT, onOpen);
      window.removeEventListener('paste', onPaste);
    };
  }, [open, openWith]);

  useEffect(() => {
    if (!created) return;
    const timer = setTimeout(() => setCreated(null), 8000);
    return () => clearTimeout(timer);
  }, [created]);

  const onCreated = async (link: CreatedLink) => {
    const copied = await copy(link.short_url);
    setCreated({ link, copied });
    router.refresh();
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => openWith()} aria-keyshortcuts="c">
        {t('table.newCta')}
        <kbd className="kbd" aria-hidden="true">
          C
        </kbd>
      </button>
      <div className="ui-toasts" role="status" aria-live="polite">
        {created && (
          <div className="ui-toast">
            <span className="lk-toast-text">
              {created.copied ? t('quick.createdCopied') : t('quick.created')}{' '}
              <span className="data">{created.link.short_url.replace(/^https?:\/\//, '')}</span>
            </span>
            <Link href={`/app/links/${created.link.id}`} className="ui-toast-action">
              {t('quick.view')}
            </Link>
            <button type="button" className="ui-toast-action lk-toast-close" onClick={() => setCreated(null)} aria-label={t('quick.dismiss')}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <QuickLinkModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={onCreated}
        domain={domain}
        customDomains={customDomains}
        initialUrl={initialUrl}
      />
    </>
  );
}

/** CTA del empty state: abre el mismo modal. */
export function NewLinkButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => window.dispatchEvent(new Event(OPEN_NEW_LINK_EVENT))}
    >
      {label}
    </button>
  );
}
