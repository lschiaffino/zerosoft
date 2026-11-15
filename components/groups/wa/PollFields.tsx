'use client';

import { useTranslations } from 'next-intl';
import { POLL_MAX_OPTIONS } from '@/lib/groups-polls';

/* Los campos de una encuesta (pregunta, opciones, varias respuestas): el diálogo del chat en Lines e Inbox,
   los envíos y los mensajes recurrentes. Aparte de RecurringParts para que Inbox no cargue sus textos. */

/** Pregunta, opciones (2 a 12) y "varias respuestas". */
export function PollFields({
  question,
  options,
  multi,
  onChange,
  idPrefix = 'poll',
}: {
  question: string;
  options: string[];
  multi: boolean;
  onChange: (v: { question: string; options: string[]; multi: boolean }) => void;
  idPrefix?: string;
}) {
  const t = useTranslations('groups');
  const set = (patch: Partial<{ question: string; options: string[]; multi: boolean }>) => onChange({ question, options, multi, ...patch });
  return (
    <div className="ui-fields gr-poll-fields">
      <label className="ui-field">
        <span className="label">{t('polls.question')}</span>
        <input className="input" value={question} onChange={(e) => set({ question: e.target.value })} maxLength={255} placeholder={t('polls.questionPlaceholder')} />
      </label>
      <fieldset className="ui-field">
        <legend className="label">{t('polls.options')}</legend>
        {options.map((o, i) => (
          <div key={`${idPrefix}-${i}`} className="gr-inline-form">
            <input
              className="input"
              value={o}
              onChange={(e) => set({ options: options.map((x, j) => (j === i ? e.target.value : x)) })}
              maxLength={100}
              aria-label={t('polls.optionN', { n: i + 1 })}
              placeholder={t('polls.optionN', { n: i + 1 })}
            />
            {options.length > 2 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ options: options.filter((_, j) => j !== i) })} aria-label={t('polls.removeOption', { n: i + 1 })}>
                {t('common.remove')}
              </button>
            )}
          </div>
        ))}
        {options.length < POLL_MAX_OPTIONS && (
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ options: [...options, ''] })}>
              {t('polls.addOption')}
            </button>
          </div>
        )}
      </fieldset>
      <label className="gr-check-label">
        <input type="checkbox" className="ui-check" checked={multi} onChange={(e) => set({ multi: e.target.checked })} />
        {t('polls.multi')}
      </label>
    </div>
  );
}
