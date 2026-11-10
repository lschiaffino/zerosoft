'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import { useThemePref } from '@/components/theme/ThemeProvider';
import { THEME_PREFS } from '@/lib/color-theme';

/**
 * Ajustes › Apariencia: modo de color (sistema, claro u oscuro) con una
 * muestra de cada uno. Es el mismo valor que el selector del sidebar: se
 * aplica al momento y se recuerda en este navegador.
 */
export default function AppearanceSettings() {
  const t = useTranslations('settings.appearance');
  const tTheme = useTranslations('common.theme');
  const { pref, setPref } = useThemePref();

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
