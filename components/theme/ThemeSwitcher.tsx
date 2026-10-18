'use client';

import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import { THEME_PREFS } from '@/lib/color-theme';
import { useThemePref } from './ThemeProvider';

const ICON = { system: 'themeSystem', light: 'themeLight', dark: 'themeDark' } as const;

/** Sistema / claro / oscuro: tres botones con ícono, junto al selector de idioma. */
export default function ThemeSwitcher({ className = '' }: { className?: string }) {
  const t = useTranslations('common.theme');
  const { pref, setPref } = useThemePref();

  return (
    <div
      className={`theme-switcher ${className}`.trim()}
      role="radiogroup"
      aria-label={t('label')}
      data-testid="theme-switcher"
    >
      {THEME_PREFS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={pref === p}
          aria-label={t(p)}
          title={t(p)}
          data-theme-pref={p}
          className={pref === p ? 'active' : undefined}
          onClick={() => setPref(p)}
        >
          <Icon name={ICON[p]} size={14} />
        </button>
      ))}
    </div>
  );
}
