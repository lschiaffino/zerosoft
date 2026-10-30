'use client';

import { useTranslations } from 'next-intl';
import { FONT_KEYS, THEME_PRESETS, type FormSettings, type FormTheme } from '@/lib/forms/types';
import { Field } from './BuildPanel';

const HEX = /^#[0-9a-f]{6}$/i;

/** Texto legible encima de un color (negro o blanco según la luminancia). */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

/** Modo (de a una o todo junto), barra de progreso y tema: plantillas, colores de la marca o propios. */
export default function DesignPanel({ settings, setSettings, brandColors }: { settings: FormSettings; setSettings: (p: Partial<FormSettings>) => void; brandColors: string[] }) {
  const t = useTranslations('forms.builder.design');
  const theme = settings.theme;
  const setTheme = (p: Partial<FormTheme>) => setSettings({ theme: { ...theme, ...p } });
  const brand = brandColors.filter((c) => HEX.test(c));
  return (
    <div className="ui-fields fm-design">
      <fieldset className="fm-radio-row">
        <legend className="label">{t('mode')}</legend>
        {(['conversational', 'classic'] as const).map((m) => (
          <label key={m} className="ui-check">
            <input type="radio" name="fm-mode" checked={settings.mode === m} onChange={() => setSettings({ mode: m })} />
            <span>
              <strong>{t(`modes.${m}`)}</strong> · {t(`modes.${m}Help`)}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="ui-check">
        <input type="checkbox" checked={settings.progressBar} onChange={(e) => setSettings({ progressBar: e.target.checked })} />
        <span>{t('progressBar')}</span>
      </label>
      <fieldset className="fm-presets">
        <legend className="label">{t('presets')}</legend>
        {Object.entries(THEME_PRESETS).map(([key, p]) => (
          <button key={key} type="button" className="fm-preset" onClick={() => setTheme(p)} aria-pressed={JSON.stringify(p) === JSON.stringify(theme)} style={{ background: p.background, color: p.text, borderColor: p.accent }}>
            <span className="fm-preset-dot" style={{ background: p.accent }} aria-hidden="true" />
            {t(`preset.${key}`)}
          </button>
        ))}
        {brand.length > 0 && (
          <button
            type="button"
            className="fm-preset"
            onClick={() => {
              const accent = brand[0];
              setTheme({ accent, onAccent: inkOn(accent), background: '#ffffff', text: '#1a1a1a' });
            }}
            style={{ borderColor: brand[0] }}
          >
            <span className="fm-preset-dot" style={{ background: brand[0] }} aria-hidden="true" />
            {t('brand')}
          </button>
        )}
      </fieldset>
      {!brand.length && <p className="ui-help">{t('brandHelp')}</p>}
      <div className="fm-colors">
        {(['background', 'text', 'accent', 'onAccent'] as const).map((k) => (
          <Field key={k} label={t(`colors.${k}`)} id={`fm-color-${k}`}>
            <div className="fm-color">
              <input id={`fm-color-${k}`} type="color" value={theme[k]} onChange={(e) => setTheme({ [k]: e.target.value.toLowerCase() } as Partial<FormTheme>)} />
              <span className="mono">{theme[k]}</span>
            </div>
          </Field>
        ))}
      </div>
      <Field label={t('font')} id="fm-font">
        <select id="fm-font" className="select" value={theme.font} onChange={(e) => setTheme({ font: e.target.value as FormTheme['font'] })}>
          {FONT_KEYS.map((f) => (
            <option key={f} value={f}>
              {t(`fonts.${f}`)}
            </option>
          ))}
        </select>
      </Field>
      <div className="fm-swatch" style={{ background: theme.background, color: theme.text }} aria-hidden="true">
        <span>{t('sample')}</span>
        <span className="fm-swatch-btn" style={{ background: theme.accent, color: theme.onAccent }}>
          OK
        </span>
      </div>
    </div>
  );
}
