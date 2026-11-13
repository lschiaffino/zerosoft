'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useChatDisplay } from '@/components/chat-style/ChatStyle';
import { firstUrl } from './format';
import { Close, LinkIcon } from './icons';
import { domainOf, fetchPreview, safeImage, type LinkPreviewData } from './link-preview-data';

/** Espera después de la última tecla antes de leer el link (pegar un link lo muestra casi enseguida). */
const DEBOUNCE_MS = 400;

/**
 * Vista previa del link mientras se escribe, arriba del campo, como en
 * WhatsApp: imagen, título, descripción y dominio, con una X para sacarla.
 * Se manda con vista previa salvo que la persona la saque (linkPreview
 * false); sacada, vale para ese link: si se escribe otro, vuelve.
 *
 * `card` va arriba de la barra del composer; `linkPreview` va en el envío;
 * `reset()` después de mandar.
 */
export function useComposerLinkPreview(text: string, opts: { disabled?: boolean } = {}): { card: ReactNode; linkPreview: boolean; reset: () => void } {
  const { linkPreviews } = useChatDisplay();
  const off = opts.disabled || linkPreviews === 'off';
  const raw = off ? '' : firstUrl(text);
  const [url, setUrl] = useState('');
  const [dismissed, setDismissed] = useState('');
  const [data, setData] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  // El link escrito, con espera: no se lee "https://ex", "https://exa", ...
  useEffect(() => {
    if (!raw) {
      setUrl('');
      return;
    }
    const t = window.setTimeout(() => setUrl(raw), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [raw]);

  useEffect(() => {
    setData(null);
    if (!url || url === dismissed) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void fetchPreview(url).then((d) => {
      if (!alive) return;
      setData(d?.title ? d : null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [url, dismissed]);

  const reset = useCallback(() => {
    setDismissed('');
    setData(null);
    setUrl('');
  }, []);

  // Lo que sale: sin vista previa solo si se sacó la de este link.
  const linkPreview = !(raw && raw === dismissed);
  const showing = !!raw && raw === url && url !== dismissed && (loading || !!data);
  const card = showing ? <ComposerCard data={data} url={url} onDismiss={() => setDismissed(url)} /> : null;
  return { card, linkPreview, reset };
}

function ComposerCard({ data, url, onDismiss }: { data: LinkPreviewData | null; url: string; onDismiss: () => void }) {
  const t = useTranslations('inboxWa.linkPreview');
  const [broken, setBroken] = useState('');
  const image = safeImage(data?.image);
  const shown = image && image !== broken ? image : '';
  return (
    <div className="wa-compose-link" data-testid="composer-link-preview" role="group" aria-label={t('composerLabel')} aria-busy={!data || undefined}>
      {data ? (
        <>
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="wa-compose-link-img" src={shown} alt="" onError={() => setBroken(shown)} />
          ) : (
            <span className="wa-compose-link-img is-empty" aria-hidden="true">
              <LinkIcon size={22} />
            </span>
          )}
          <span className="wa-compose-link-text">
            <strong dir="auto">{data.title}</strong>
            {data.description && <span dir="auto">{data.description}</span>}
            <small>{domainOf(url)}</small>
          </span>
        </>
      ) : (
        <span className="wa-compose-link-text is-loading" role="status">
          <small>{t('loading')}</small>
        </span>
      )}
      <button type="button" className="wa-icon-btn" onClick={onDismiss} aria-label={t('remove')} title={t('remove')}>
        <Close size={18} />
      </button>
    </div>
  );
}
