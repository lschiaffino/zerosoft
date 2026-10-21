'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { DEFAULT_CALL_OUTCOMES, isDefaultOutcome, MAX_CALL_OUTCOMES, normalizeCallOutcomes } from '@/lib/crm-calls';

interface CallOutcomesSettingsProps {
  outcomes: string[];
  custom: boolean;
  canEdit: boolean;
}

/**
 * Ajustes › Ventas › Resultados de llamada: la lista que se elige al registrar
 * una llamada o un WhatsApp. Uno por línea; vacía vuelve a los de siempre.
 */
export default function CallOutcomesSettings({ outcomes, custom, canEdit }: CallOutcomesSettingsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const label = (o: string) => (isDefaultOutcome(o) ? t(`calls.outcomes.${o}`) : o);
  // Los de siempre se muestran traducidos: al guardarlos pasan a ser texto propio.
  const [text, setText] = useState((custom ? outcomes : [...DEFAULT_CALL_OUTCOMES]).map(label).join('\n'));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function save(list: string[] | null) {
    setBusy(true);
    setSaved(false);
    setError(false);
    const res = await fetch('/api/crm/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callOutcomes: list }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    if (list === null) setText(DEFAULT_CALL_OUTCOMES.map(label).join('\n'));
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="ui-field">
      <label className="label" htmlFor="call-outcomes">
        {t('calls.settingsLabel')}
      </label>
      <textarea
        id="call-outcomes"
        className="textarea"
        rows={6}
        value={text}
        disabled={!canEdit || busy}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        aria-describedby="call-outcomes-help"
      />
      <p className="ui-help" id="call-outcomes-help">
        {t('calls.settingsHelp', { max: MAX_CALL_OUTCOMES })}
      </p>
      {canEdit && (
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void save(normalizeCallOutcomes(text.split('\n')))}
          >
            {t('common.save')}
          </button>
          {custom && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save(null)}>
              {t('calls.settingsReset')}
            </button>
          )}
          {saved && <span className="saved-note">{t('common.saved')}</span>}
        </div>
      )}
      {error && <p className="form-error">{t('errors.generic')}</p>}
    </div>
  );
}
