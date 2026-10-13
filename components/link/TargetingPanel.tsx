'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { LinkTargeting, DeviceTarget } from '@/lib/link-targeting';

const DEVICES: DeviceTarget[] = ['ios', 'android', 'desktop'];

interface RuleDraft {
  countries: string;
  devices: DeviceTarget[];
  url: string;
}

interface Props {
  linkId: string;
  defaultUrl: string;
  initial: LinkTargeting | null;
}

/** Reglas por país/dispositivo, A/B con pesos y deep links de un link. */
export default function TargetingPanel({ linkId, defaultUrl, initial }: Props) {
  const t = useTranslations('link.targeting');
  const router = useRouter();
  const [rules, setRules] = useState<RuleDraft[]>(
    (initial?.rules ?? []).map((r) => ({ countries: r.countries.join(', '), devices: r.devices, url: r.url })),
  );
  const [ab, setAb] = useState(initial?.ab ?? []);
  const [iosApp, setIosApp] = useState(initial?.ios?.app ?? '');
  const [iosFallback, setIosFallback] = useState(initial?.ios?.fallback ?? '');
  const [androidApp, setAndroidApp] = useState(initial?.android?.app ?? '');
  const [androidFallback, setAndroidFallback] = useState(initial?.android?.fallback ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  function payload() {
    return {
      rules: rules
        .filter((r) => r.url.trim())
        .map((r) => ({
          countries: r.countries
            .split(/[\s,]+/)
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
          devices: r.devices,
          url: r.url.trim(),
        })),
      ab: ab.filter((v) => v.url.trim()).map((v) => ({ url: v.url.trim(), weight: v.weight })),
      ios: iosApp.trim() ? { app: iosApp.trim(), fallback: iosFallback.trim() || null } : null,
      android: androidApp.trim() ? { app: androidApp.trim(), fallback: androidFallback.trim() || null } : null,
    };
  }

  async function save(targeting: ReturnType<typeof payload> | null) {
    setError(null);
    setState('saving');
    const res = await fetch(`/api/links/${linkId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targeting }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(t('error', { code: data?.error ?? res.status }));
      setState('idle');
      return;
    }
    setState('saved');
    router.refresh();
  }

  function clearAll() {
    setRules([]);
    setAb([]);
    setIosApp('');
    setIosFallback('');
    setAndroidApp('');
    setAndroidFallback('');
    void save(null);
  }

  const touched = () => state === 'saved' && setState('idle');

  return (
    <div className="tg" onChange={touched}>
      <p className="muted tg-hint">{t('hint')}</p>

      <div className="tg-block">
        <p className="section-label">{t('rules')}</p>
        <p className="field-hint">{t('rulesHint')}</p>
        {rules.map((r, i) => (
          <div className="tg-row" key={i} data-testid="tg-rule">
            <input
              className="input tg-countries mono"
              aria-label={t('countries')}
              placeholder={t('countriesPlaceholder')}
              value={r.countries}
              onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, countries: e.target.value } : x)))}
            />
            <div className="tg-devices" role="group" aria-label={t('devices')}>
              {DEVICES.map((d) => (
                <label key={d} className="tg-check mono">
                  <input
                    type="checkbox"
                    checked={r.devices.includes(d)}
                    onChange={(e) =>
                      setRules(
                        rules.map((x, j) =>
                          j === i
                            ? { ...x, devices: e.target.checked ? [...x.devices, d] : x.devices.filter((y) => y !== d) }
                            : x,
                        ),
                      )
                    }
                  />
                  {t(d)}
                </label>
              ))}
            </div>
            <input
              className="input tg-url"
              aria-label={t('destination')}
              placeholder="https://"
              value={r.url}
              onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
              {t('remove')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => setRules([...rules, { countries: '', devices: [], url: '' }])}
        >
          {t('addRule')}
        </button>
      </div>

      <div className="tg-block">
        <p className="section-label">{t('ab')}</p>
        <p className="field-hint">{t('abHint')}</p>
        {ab.map((v, i) => (
          <div className="tg-row tg-row-ab" key={i} data-testid="tg-variant">
            <span className="mono tg-variant">{t('variant', { name: String.fromCharCode(65 + i) })}</span>
            <input
              className="input tg-url"
              aria-label={t('destination')}
              placeholder="https://"
              value={v.url}
              onChange={(e) => setAb(ab.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            />
            <label className="tg-weight mono">
              {t('weight')}
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={v.weight}
                onChange={(e) =>
                  setAb(ab.map((x, j) => (j === i ? { ...x, weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : x)))
                }
              />
            </label>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setAb(ab.filter((_, j) => j !== i))}>
              {t('remove')}
            </button>
          </div>
        ))}
        {ab.length < 5 && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() =>
              setAb(
                ab.length === 0
                  ? [
                      { url: defaultUrl, weight: 50 },
                      { url: '', weight: 50 },
                    ]
                  : [...ab, { url: '', weight: 50 }],
              )
            }
          >
            {t('addVariant')}
          </button>
        )}
      </div>

      <div className="tg-block">
        <p className="section-label">{t('deep')}</p>
        <p className="field-hint">{t('deepHint')}</p>
        <div className="tg-deep">
          <label className="field">
            <span className="label">{t('iosApp')}</span>
            <input className="input mono" placeholder={t('appPlaceholder')} value={iosApp} onChange={(e) => setIosApp(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{t('fallback')}</span>
            <input
              className="input"
              placeholder="https://apps.apple.com/…"
              value={iosFallback}
              onChange={(e) => setIosFallback(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">{t('androidApp')}</span>
            <input
              className="input mono"
              placeholder={t('appPlaceholder')}
              value={androidApp}
              onChange={(e) => setAndroidApp(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">{t('fallback')}</span>
            <input
              className="input"
              placeholder="https://play.google.com/…"
              value={androidFallback}
              onChange={(e) => setAndroidFallback(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="tg-actions">
        <button type="button" className="btn btn-small" disabled={state === 'saving'} onClick={() => void save(payload())}>
          {state === 'saving' ? t('saving') : t('save')}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={clearAll}>
          {t('clear')}
        </button>
        {state === 'saved' && <span className="mono muted">{t('saved')}</span>}
        {error && (
          <span className="tg-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
