'use client';

import { useTranslations } from 'next-intl';
import ChatIcon from './icons';

export const WIDGET_SWATCHES = ['#e23d7f', '#2f6bff', '#0e9f6e', '#f2611d', '#7b4dff', '#111111'];

/**
 * Color del widget: seis muestras cuadradas (radio) y un selector libre.
 * Lo usan el modal de crear y la pestaña Apariencia, así se ven iguales.
 */
export default function ColorField({
  value,
  onChange,
  labelId,
}: {
  value: string;
  onChange: (color: string) => void;
  /** id del label visible que nombra el grupo. */
  labelId: string;
}) {
  const t = useTranslations('chat');
  const current = WIDGET_SWATCHES.indexOf(value.toLowerCase());
  const custom = current < 0;

  // Radio con foco itinerante: Tab entra a la muestra elegida, las flechas cambian el color.
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + WIDGET_SWATCHES.length) % WIDGET_SWATCHES.length;
    onChange(WIDGET_SWATCHES[next]);
    const group = e.currentTarget.parentElement;
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div className="chat-swatches" role="radiogroup" aria-labelledby={labelId}>
      {WIDGET_SWATCHES.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={current === i}
          tabIndex={current === i || (custom && i === 0) ? 0 : -1}
          aria-label={c}
          title={c}
          className="chat-swatch"
          style={{ backgroundColor: c }}
          onClick={() => onChange(c)}
          onKeyDown={(e) => onKeyDown(e, i)}
        />
      ))}
      <label className="chat-swatch-custom" data-active={custom || undefined} title={t('widgetForm.customColor')}>
        <span className="sr-only">{t('widgetForm.customColor')}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        {!custom && (
          <span className="chat-swatch-plus" aria-hidden="true">
            <ChatIcon name="plus" size={14} />
          </span>
        )}
      </label>
      <span className="chat-swatch-value data">{value.toUpperCase()}</span>
    </div>
  );
}
