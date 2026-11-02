'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import type { SurveyAppearance, SurveyQuestion } from '@/lib/analytics/more-types';

/**
 * Cómo se ve la encuesta en el sitio (mismos colores y forma que el popover
 * de public/zs.js), dentro de la página: los controles no envían nada.
 */
export default function SurveyPreview({
  questions,
  appearance,
  index,
  onIndex,
}: {
  questions: SurveyQuestion[];
  appearance: SurveyAppearance;
  index: number;
  onIndex: (i: number) => void;
}) {
  const t = useTranslations('analyticsMore.editor');
  const q = questions[index];
  if (!q) return null;
  const vars = { '--sv-b': appearance.background, '--sv-t': appearance.text, '--sv-bb': appearance.button, '--sv-bt': appearance.buttonText } as CSSProperties;
  return (
    <div className="an-form">
      <div className={`an-sv-stage is-${appearance.position}`} data-testid="an-sv-preview">
        <div className="an-sv-pop" style={vars}>
          <span className="an-sv-x" aria-hidden="true">
            ×
          </span>
          <p className="an-sv-q">{q.text}</p>
          {q.description && <p className="an-sv-d">{q.description}</p>}
          {q.type === 'rating' && (
            <>
              <div className="an-sv-rate" aria-hidden="true">
                {Array.from({ length: q.scale === 10 ? 11 : q.scale }, (_, i) => (
                  <span key={i}>{q.scale === 10 ? i : i + 1}</span>
                ))}
              </div>
              {(q.lowLabel || q.highLabel) && (
                <div className="an-sv-ends">
                  <span>{q.lowLabel}</span>
                  <span>{q.highLabel}</span>
                </div>
              )}
            </>
          )}
          {(q.type === 'single' || q.type === 'multiple') && (
            <ul className="an-sv-choices" role="list">
              {q.choices.filter(Boolean).map((c) => (
                <li key={c}>
                  <i className={q.type === 'single' ? 'is-round' : ''} aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
          )}
          {q.type === 'open' && <div className="an-sv-area" aria-hidden="true" />}
          <span className="an-sv-go">{appearance.submitText || 'Submit'}</span>
        </div>
      </div>
      {questions.length > 1 && (
        <div className="an-row an-wrap" role="group" aria-label={t('previewQuestion')}>
          {questions.map((_, i) => (
            <button key={i} type="button" className="btn btn-ghost btn-sm" aria-pressed={i === index} onClick={() => onIndex(i)}>
              {t('questionN', { n: i + 1 })}
            </button>
          ))}
        </div>
      )}
      {appearance.thankYou && (
        <p className="an-note">
          {t('previewThanks')}: {appearance.thankYou}
        </p>
      )}
    </div>
  );
}
