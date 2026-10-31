'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import { errorText } from './robots-ui';

/** Corridas a la vez y qué pueden hacer los members. Solo admins cambian esto. */
export default function RobotsWorkspaceSettings({
  initial,
  maxConcurrency,
  canEdit,
}: {
  initial: { concurrency: number; membersCanBuild: boolean };
  maxConcurrency: number;
  canEdit: boolean;
}) {
  const t = useTranslations('robots.workspace');
  const tr = useTranslations('robots');
  const uid = useId();
  const [config, setConfig] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(patch: Partial<typeof config>) {
    const before = config;
    setConfig({ ...config, ...patch });
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/robots/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) {
      setConfig(before);
      setMessage({ ok: false, text: errorText(tr, data?.error) });
      return;
    }
    setMessage({ ok: true, text: t('saved') });
  }

  return (
    <div className="st-stack">
      <FormSection title={t('concurrencyTitle')} description={t('concurrencyHint', { max: maxConcurrency })}>
        <div className="ui-field robots-narrow">
          <label className="label" htmlFor={`${uid}-concurrency`}>
            {t('concurrency')}
          </label>
          <select
            id={`${uid}-concurrency`}
            className="select"
            value={config.concurrency}
            disabled={!canEdit || busy}
            onChange={(e) => void save({ concurrency: Number(e.target.value) })}
          >
            {Array.from({ length: maxConcurrency }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </FormSection>
      <FormSection title={t('membersTitle')} description={t('membersHint')}>
        <label className="robots-inline">
          <input type="checkbox" checked={config.membersCanBuild} disabled={!canEdit || busy} onChange={(e) => void save({ membersCanBuild: e.target.checked })} />
          <span>{t('members')}</span>
        </label>
      </FormSection>
      {!canEdit && <p className="robots-muted robots-small">{t('adminOnly')}</p>}
      <p className={message?.ok === false ? 'robots-note-warn' : 'robots-muted robots-small'} role="status">
        {message?.text ?? ''}
      </p>
    </div>
  );
}
