'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalDate from '@/components/ui/LocalDate';
import BiDialog from './BiDialog';
import { biApi, biErrorText } from './client';

interface Share {
  id: string;
  createdAt: string;
  token?: string;
}

/**
 * Links públicos de una pregunta o tablero: los crea un admin, el link
 * completo se ve una sola vez (se guarda solo su hash) y se puede apagar.
 * Incluye el código para incrustarlo con un iframe.
 */
export default function SharePanel({ open, onClose, kind, targetId, isAdmin }: { open: boolean; onClose: () => void; kind: 'question' | 'dashboard'; targetId: string; isAdmin: boolean }) {
  const t = useTranslations('bi');
  const locale = useLocale();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [fresh, setFresh] = useState<Share | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFresh(null);
    setError(null);
    biApi<{ shares: Share[] }>(`/api/bi/shares?kind=${kind}&target=${encodeURIComponent(targetId)}`)
      .then((d) => setShares(d.shares))
      .catch((err) => {
        setShares([]);
        setError(biErrorText(err, t));
      });
  }, [open, kind, targetId, t]);

  const url = fresh?.token ? `${window.location.origin}/${locale}/stats/bi/${fresh.token}` : '';
  const embed = url ? `<iframe src="${url}?embed=1" width="100%" height="600" style="border:0" title="Analytics"></iframe>` : '';
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <BiDialog open={open} title={t('share.title')} onClose={onClose} wide>
      <div className="ui-modal-body ui-fields bi-share">
        <p className="bi-muted">{t('share.body')}</p>
        {!isAdmin && <p className="bi-muted">{t('share.adminOnly')}</p>}
        {fresh?.token && (
          <div className="bi-share-fresh" data-testid="bi-share-url">
            <label className="ui-field">
              <span className="label">{t('share.link')}</span>
              <span className="bi-copy-row">
                <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn btn-sm" onClick={() => void copy(url, 'url')}>
                  {copied === 'url' ? t('share.copied') : t('share.copy')}
                </button>
              </span>
            </label>
            <label className="ui-field">
              <span className="label">{t('share.embed')}</span>
              <span className="bi-copy-row">
                <input className="input" readOnly value={embed} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn btn-sm" onClick={() => void copy(embed, 'embed')}>
                  {copied === 'embed' ? t('share.copied') : t('share.copy')}
                </button>
              </span>
            </label>
            <p className="bi-muted">{t('share.onlyOnce')}</p>
          </div>
        )}
        {shares === null ? (
          <p className="bi-muted" role="status">
            {t('common.loading')}
          </p>
        ) : shares.length === 0 ? (
          <p className="bi-muted">{t('share.none')}</p>
        ) : (
          <ul className="bi-share-list" role="list">
            {shares.map((s) => (
              <li key={s.id}>
                <span>
                  {t('share.createdAt')} <LocalDate value={s.createdAt} locale={locale} />
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await biApi(`/api/bi/shares/${s.id}`, { method: 'DELETE' });
                        setShares((list) => (list ?? []).filter((x) => x.id !== s.id));
                        if (fresh?.id === s.id) setFresh(null);
                      } catch (err) {
                        setError(biErrorText(err, t));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t('share.revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t('common.close')}
        </button>
        {isAdmin && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const { share } = await biApi<{ share: Share }>('/api/bi/shares', { body: { kind, targetId } });
                setFresh(share);
                setShares((list) => [...(list ?? []), share]);
              } catch (err) {
                setError(biErrorText(err, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('share.create')}
          </button>
        )}
      </div>
    </BiDialog>
  );
}
