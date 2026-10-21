'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';

type EmailMode = 'immediate' | 'digest' | 'off';

const MODES: EmailMode[] = ['immediate', 'digest', 'off'];

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function timeZones(current: string): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const list = supported ? supported('timeZone') : [];
  return Array.from(new Set(['UTC', current, ...list])).filter(Boolean);
}

/**
 * Avisos por email de Track (pestaña de los ajustes de Track): al momento,
 * resumen diario a las 8 de la zona elegida o nada. Es por persona.
 */
export default function NotifySettings({ locale }: { locale: string }) {
  const t = useTranslations('track');
  const [mode, setMode] = useState<EmailMode | null>(null);
  const [timezone, setTimezone] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const zones = useMemo(() => timeZones(timezone || browserTimeZone()), [timezone]);

  useEffect(() => {
    let alive = true;
    void fetch('/api/track/notify-prefs')
      .then((res) => (res.ok ? (res.json() as Promise<{ emailMode: EmailMode; timezone: string | null }>) : null))
      .then((data) => {
        if (!alive) return;
        if (!data) {
          setLoadFailed(true);
          setMode('digest');
          setTimezone(browserTimeZone());
          return;
        }
        setMode(data.emailMode);
        setTimezone(data.timezone || browserTimeZone());
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  async function save(): Promise<string | void> {
    if (!mode) return;
    const res = await fetch('/api/track/notify-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailMode: mode, timezone, locale: ['en', 'es', 'pt'].includes(locale) ? locale : 'en' }),
    }).catch(() => null);
    if (!res?.ok) return t('notifySettings.error');
  }

  return (
    <div data-testid="track-notify-settings">
      <FormSection
        title={t('notifySettings.title')}
        description={t('notifySettings.help')}
        onSubmit={() => save()}
        disabled={!mode}
        note={loadFailed ? t('notifySettings.error') : undefined}
      >
        <div className="ui-field">
          <label className="label" htmlFor="track-notify-mode">
            {t('notifySettings.mode')}
          </label>
          <select
            id="track-notify-mode"
            className="select"
            value={mode ?? ''}
            disabled={!mode}
            onChange={(e) => setMode(e.target.value as EmailMode)}
            aria-describedby="track-notify-mode-help"
            data-testid="track-notify-mode"
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`notifySettings.${m}`)}
              </option>
            ))}
          </select>
          <p className="ui-help" id="track-notify-mode-help">
            {mode ? t(`notifySettings.${mode}Help`) : ''}
          </p>
        </div>
        {mode === 'digest' && (
          <div className="ui-field">
            <label className="label" htmlFor="track-notify-tz">
              {t('notifySettings.timezone')}
            </label>
            <select id="track-notify-tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
        )}
      </FormSection>
    </div>
  );
}
