'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import { useThemePref } from '@/components/theme/ThemeProvider';
import { THEME_PREFS } from '@/lib/color-theme';
import { useState } from 'react';
import { useLook } from '@/components/theme/LookProvider';
import { LOOKS, type Look } from '@/lib/look';

/**
 * Ajustes › Apariencia: modo de color (sistema, claro u oscuro) con una
 * muestra de cada uno. Es el mismo valor que el selector del sidebar: se
 * aplica al momento y se recuerda en este navegador. Debajo, el aspecto
 * (lib/look.ts): se aplica al momento y se guarda en la cuenta. Al final, los
 * tours guiados (lib/tours): si se abren solos y volver a verlos todos.
 */
export default function AppearanceSettings({ toursOff = false }: { toursOff?: boolean }) {
  const t = useTranslations('settings.appearance');
  const tTheme = useTranslations('common.theme');
  const { pref, setPref } = useThemePref();
  const { look, setLook } = useLook();
  const [lookStatus, setLookStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const chooseLook = async (next: Look) => {
    setLookStatus('idle');
    setLookStatus((await setLook(next)) ? 'saved' : 'error');
  };
  const [toursOn, setToursOn] = useState(!toursOff);
  const [toursStatus, setToursStatus] = useState<'idle' | 'reset' | 'error'>('idle');
  const saveTours = async (body: Record<string, unknown>) =>
    fetch('/api/tours', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.ok)
      .catch(() => false);
  const toggleTours = async (on: boolean) => {
    setToursOn(on);
    setToursStatus('idle');
    if (!(await saveTours({ kind: 'off', off: !on }))) {
      setToursOn(!on);
      setToursStatus('error');
    }
  };
  const resetTours = async () => {
    setToursStatus('idle');
    if (await saveTours({ kind: 'reset' })) {
      setToursOn(true);
      setToursStatus('reset');
    } else setToursStatus('error');
  };

  return (
    <div className="st-stack">
      <FormSection title={t('title')} description={t('desc')}>
        <fieldset className="st-fieldset">
          <legend className="sr-only">{tTheme('label')}</legend>
          <div className="st-theme-options" role="radiogroup" aria-label={tTheme('label')} data-testid="appearance-theme">
            {THEME_PREFS.map((p) => (
              <label key={p} className="st-theme-option" htmlFor={`theme-${p}`}>
                <input id={`theme-${p}`} type="radio" name="theme" value={p} checked={pref === p} onChange={() => setPref(p)} />
                <span className="st-theme-swatch" data-theme={p} aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span className="st-theme-label">{tTheme(p)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="ui-help">{t('themeHelp')}</p>
      </FormSection>
      <FormSection title={t('lookTitle')} description={t('lookDesc')}>
        <fieldset className="st-fieldset">
          <legend className="sr-only">{t('lookLabel')}</legend>
          <div className="st-look-options" role="radiogroup" aria-label={t('lookLabel')} data-testid="appearance-look">
            {LOOKS.map((l) => (
              <label key={l} className="st-look-option" htmlFor={`look-${l}`}>
                <input id={`look-${l}`} type="radio" name="look" value={l} checked={look === l} onChange={() => chooseLook(l)} data-testid={`look-${l}`} />
                <span className="st-look-swatch" data-look={l} aria-hidden="true">
                  <i className="s-bar" />
                  <i className="s-btn" />
                  <i className="s-menu" />
                  <i className="s-row r1" />
                  <i className="s-row r2" />
                  <i className="s-row r3" />
                </span>
                <span className="st-look-name">{t(`looks.${l}.name`)}</span>
                <span className="st-look-desc">{t(`looks.${l}.desc`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="ui-help" role="status" data-testid="appearance-look-status">
          {lookStatus === 'saved' ? t('lookSaved') : lookStatus === 'error' ? t('lookError') : null}
        </p>
      </FormSection>
      <FormSection title={t('toursTitle')} description={t('toursDesc')}>
        <label className="ui-check">
          <input type="checkbox" checked={toursOn} onChange={(e) => void toggleTours(e.target.checked)} data-testid="appearance-tours-auto" />
          <span>{t('toursAuto')}</span>
        </label>
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void resetTours()} data-testid="appearance-tours-reset">
            {t('toursReset')}
          </button>
        </div>
        <p className={toursStatus === 'error' ? 'ui-error' : 'ui-help'} role="status" data-testid="appearance-tours-status">
          {toursStatus === 'reset' ? t('toursResetDone') : toursStatus === 'error' ? t('toursError') : null}
        </p>
      </FormSection>
      <FormSection title={t('languageTitle')} description={t('languageDesc')}>
        <p className="ui-help">
          <Link href="/app/settings" className="st-inline-link">
            {t('languageLink')}
          </Link>
        </p>
      </FormSection>
    </div>
  );
}
