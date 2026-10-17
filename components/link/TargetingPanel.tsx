'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { LinkTargeting, DeviceTarget } from '@/lib/link-targeting';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';

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

/**
 * Ruteo de un link: reglas por país y dispositivo a la vista; A/B con pesos y
 * deep links a apps en "Avanzado". Un solo Guardar para todo.
 */
export default function TargetingPanel({ linkId, defaultUrl, initial }: Props) {
  const t = useTranslations('link.targeting');
  const te = useTranslations('link.errors');
  const router = useRouter();
  const [rules, setRules] = useState<RuleDraft[]>(
    (initial?.rules ?? []).map((r) => ({ countries: r.countries.join(', '), devices: r.devices, url: r.url })),
  );
  const [ab, setAb] = useState(initial?.ab ?? []);
  const [iosApp, setIosApp] = useState(initial?.ios?.app ?? '');
  const [iosFallback, setIosFallback] = useState(initial?.ios?.fallback ?? '');
  const [androidApp, setAndroidApp] = useState(initial?.android?.app ?? '');
  const [androidFallback, setAndroidFallback] = useState(initial?.android?.fallback ?? '');
  const [clearError, setClearError] = useState<string | null>(null);

  const hasAdvanced = (initial?.ab.length ?? 0) > 0 || !!initial?.ios || !!initial?.android;

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

  /** Una regla con países o dispositivos (o una variante) sin URL no se descarta en silencio. */
  function hasIncompleteRows() {
    return (
      rules.some((r) => !r.url.trim() && (r.countries.trim() || r.devices.length > 0)) ||
      ab.some((v) => !v.url.trim())
    );
  }

  async function send(targeting: ReturnType<typeof payload> | null): Promise<string | void> {
    if (targeting && hasIncompleteRows()) return t('incompleteRow');
    if (targeting?.rules.some((r) => r.countries.some((c) => !/^[A-Z]{2}$/.test(c)))) return t('countriesInvalid');
    const res = await fetch(`/api/links/${linkId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targeting }),
    }).catch(() => null);
    if (!res) return te('generic');
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      const code = data?.error;
      return code && te.has(code) ? te(code) : t('error', { code: code ?? res.status });
    }
    router.refresh();
  }

  async function clearAll() {
    if (!window.confirm(t('clearConfirm'))) return;
    setRules([]);
    setAb([]);
    setIosApp('');
    setIosFallback('');
    setAndroidApp('');
    setAndroidFallback('');
    setClearError((await send(null)) ?? null);
  }

  const hasAny = rules.length > 0 || ab.length > 0 || !!iosApp || !!androidApp;

  return (
    <FormSection title={t('title')} titleHidden description={t('hint')} onSubmit={() => send(payload())} submitLabel={t('save')} className="lk-form">
      <fieldset className="lk-fieldset">
        <legend className="label">{t('rules')}</legend>
        <p className="ui-help">
          {t('rulesHint')} {t('ipadNote')}
        </p>
        {rules.length > 0 && (
          <ol className="lk-rules">
            {rules.map((r, i) => (
              <li className="lk-rule" key={i} data-testid="tg-rule">
                <span className="lk-rule-n data" aria-hidden="true">
                  {i + 1}
                </span>
                <input
                  className="input mono lk-rule-countries"
                  aria-label={t('countries')}
                  placeholder={t('countriesPlaceholder')}
                  value={r.countries}
                  onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, countries: e.target.value } : x)))}
                />
                <div className="lk-rule-devices" role="group" aria-label={t('devices')}>
                  {DEVICES.map((d) => (
                    <label key={d} className="ui-check">
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
                  className="input lk-rule-url"
                  aria-label={t('destination')}
                  placeholder="https://"
                  inputMode="url"
                  value={r.url}
                  onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                  {t('remove')}
                </button>
              </li>
            ))}
          </ol>
        )}
        <div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setRules([...rules, { countries: '', devices: [], url: '' }])}
          >
            {t('addRule')}
          </button>
        </div>
      </fieldset>

      <AdvancedSection storageKey="link.routing" hint={t('advancedHint')} defaultOpen={hasAdvanced}>
        <fieldset className="lk-fieldset">
          <legend className="label">{t('ab')}</legend>
          <p className="ui-help">{t('abHint')}</p>
          {ab.length > 0 && (
            <ol className="lk-rules">
              {ab.map((v, i) => (
                <li className="lk-rule lk-rule-ab" key={i} data-testid="tg-variant">
                  <span className="lk-rule-n data" aria-hidden="true">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <input
                    className="input lk-rule-url"
                    aria-label={`${t('variant', { name: String.fromCharCode(65 + i) })}: ${t('destination')}`}
                    placeholder="https://"
                    inputMode="url"
                    value={v.url}
                    onChange={(e) => setAb(ab.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                  />
                  <div className="ui-input-group lk-rule-weight">
                    <input
                      className="input mono"
                      type="number"
                      min={0}
                      max={100}
                      aria-label={`${t('variant', { name: String.fromCharCode(65 + i) })}: ${t('weight')}`}
                      value={v.weight}
                      onChange={(e) =>
                        setAb(
                          ab.map((x, j) =>
                            j === i ? { ...x, weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : x,
                          ),
                        )
                      }
                    />
                    <span className="ui-addon">%</span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAb(ab.filter((_, j) => j !== i))}>
                    {t('remove')}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {ab.length < 5 && (
            <div>
              <button
                type="button"
                className="btn btn-sm"
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
            </div>
          )}
        </fieldset>

        <fieldset className="lk-fieldset">
          <legend className="label">{t('deep')}</legend>
          <p className="ui-help">{t('deepHint')}</p>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="tg-ios">
                {t('iosApp')}
              </label>
              <input id="tg-ios" className="input mono" placeholder={t('appPlaceholder')} value={iosApp} onChange={(e) => setIosApp(e.target.value)} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="tg-ios-fb">
                {t('fallback')}
              </label>
              <input
                id="tg-ios-fb"
                className="input"
                inputMode="url"
                placeholder="https://apps.apple.com/…"
                value={iosFallback}
                onChange={(e) => setIosFallback(e.target.value)}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="tg-android">
                {t('androidApp')}
              </label>
              <input
                id="tg-android"
                className="input mono"
                placeholder={t('appPlaceholder')}
                value={androidApp}
                onChange={(e) => setAndroidApp(e.target.value)}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="tg-android-fb">
                {t('fallback')}
              </label>
              <input
                id="tg-android-fb"
                className="input"
                inputMode="url"
                placeholder="https://play.google.com/…"
                value={androidFallback}
                onChange={(e) => setAndroidFallback(e.target.value)}
              />
            </div>
          </div>
        </fieldset>
      </AdvancedSection>

      {hasAny && (
        <div className="lk-clear">
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void clearAll()}>
            {t('clear')}
          </button>
          {clearError && (
            <span className="ui-error" role="alert">
              {clearError}
            </span>
          )}
        </div>
      )}
    </FormSection>
  );
}
