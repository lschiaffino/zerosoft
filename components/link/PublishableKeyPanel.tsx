'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CopyButton from './CopyButton';

/** Publishable key del workspace para la app móvil (deep linking diferido): copiar y rotar. */
export default function PublishableKeyPanel({ initial }: { initial: string }) {
  const t = useTranslations('link');
  const [key, setKey] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function rotate() {
    setBusy(true);
    setError(false);
    const res = await fetch('/api/links/publishable-key', { method: 'POST' }).catch(() => null);
    setBusy(false);
    setConfirm(false);
    const data = (await res?.json().catch(() => null)) as { key?: string } | null;
    if (res?.ok && data?.key) setKey(data.key);
    else setError(true);
  }

  return (
    <div className="ui-field" data-testid="publishable-key">
      <span className="label">{t('conversions.publishableKey')}</span>
      <div className="crm-app-copy">
        <code className="data">{key}</code>
        <CopyButton text={key} className="btn btn-secondary btn-sm" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)} disabled={busy}>
          {t('conversions.rotateKey')}
        </button>
      </div>
      <p className={error ? 'ui-error' : 'ui-help'} role={error ? 'alert' : undefined}>
        {error ? t('errors.generic') : t('conversions.publishableHelp')}
      </p>
      <ConfirmDialog
        open={confirm}
        title={t('conversions.rotateTitle')}
        body={t('conversions.rotateBody')}
        confirmLabel={t('conversions.rotateKey')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={rotate}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
