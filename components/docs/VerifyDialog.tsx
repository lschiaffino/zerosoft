'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import type { DocsPage } from '@/lib/docs-types';
import { formatDateTime } from '@/lib/datetime';

/**
 * Verificar una página de la wiki (como Notion): por 7, 30, 90, 180 o 365
 * días, o sin vencimiento, con su dueño (recibe el aviso cuando vence).
 */
export default function VerifyDialog({
  page,
  people,
  onClose,
  onChanged,
}: {
  page: DocsPage;
  /** Personas del workspace (id → nombre) para elegir el dueño. */
  people: Array<{ id: string; name: string }>;
  onClose: () => void;
  onChanged: (page: DocsPage) => void;
}) {
  const t = useTranslations('docs.verify');
  const locale = useLocale();
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [days, setDays] = useState<string>(page.verified_until === null && page.verified_at ? 'forever' : '90');
  const [owner, setOwner] = useState<string>(page.page_owner_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const expired = !!page.verified_until && Date.parse(page.verified_until) <= Date.now();

  async function send(method: 'POST' | 'DELETE') {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/docs/pages/${page.id}/verify`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ days: days === 'forever' ? null : Number(days), owner_id: owner || null }) : undefined,
      });
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as DocsPage;
      onChanged(fresh);
      ref.current?.close();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="ui-modal docs-verify"
      aria-labelledby={`${uid}-t`}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id={`${uid}-t`}>
          {t('title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => ref.current?.close()} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <form
        className="ui-modal-body docs-verify-body"
        onSubmit={(e) => {
          e.preventDefault();
          void send('POST');
        }}
      >
        <p className="ui-help">{t('help')}</p>
        {page.verified_at && (
          <p className={`docs-verify-state${expired ? ' is-expired' : ''}`} role="status">
            {expired
              ? t('expiredOn', { date: formatDateTime(page.verified_until!, locale) })
              : page.verified_until
                ? t('validUntil', { date: formatDateTime(page.verified_until, locale) })
                : t('validForever')}
          </p>
        )}
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-days`}>
            {t('duration')}
          </label>
          <select id={`${uid}-days`} className="select" value={days} onChange={(e) => setDays(e.target.value)}>
            {['7', '30', '90', '180', '365'].map((d) => (
              <option key={d} value={d}>
                {t('days', { count: Number(d) })}
              </option>
            ))}
            <option value="forever">{t('forever')}</option>
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-owner`}>
            {t('owner')}
          </label>
          <select id={`${uid}-owner`} className="select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('ownerMe')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="ui-help">{t('ownerHelp')}</span>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {t('error')}
          </p>
        )}
        <div className="docs-verify-actions">
          {page.verified_at && (
            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void send('DELETE')} disabled={busy}>
              {t('remove')}
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy || undefined} data-testid="docs-verify-submit">
            {page.verified_at ? t('reverify') : t('verify')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
