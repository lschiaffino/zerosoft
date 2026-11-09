'use client';

import { useLocale, useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import PageHeader from '@/components/ui/PageHeader';
import type { LlmGenerationDetail } from '@/lib/analytics/more-types';
import { fmtLatency, fmtUsd } from './LlmPage';
import { fmtNumber, fmtTime } from './client';

/** Una generación: los valores que informó el cliente, como texto. */
export default function LlmGenerationView({ g }: { g: LlmGenerationDetail }) {
  const t = useTranslations('analyticsMore.llm');
  const locale = useLocale();
  const rows: Array<[string, string]> = [
    [t('provider'), g.provider ?? '–'],
    [t('inputTokens'), fmtNumber(g.inputTokens, locale)],
    [t('outputTokens'), fmtNumber(g.outputTokens, locale)],
    [t('cost'), fmtUsd(g.costUsd, locale)],
    [t('latency'), fmtLatency(g.latencyMs)],
    [t('trace'), g.traceId ?? '–'],
    [t('person'), g.distinctId],
  ];
  return (
    <div className="app-page ui-page an-page">
      <PageHeader back={{ href: '/app/pulse/llm', label: t('title') }} title={g.model} description={<LocalText>{fmtTime(g.ts, locale)}</LocalText>} />
      <section className="an-panel an-form" aria-label={t('details')}>
        <div>{g.isError ? <span className="badge badge-bad">{t('statusError')}</span> : <span className="badge badge-ok">{t('statusOk')}</span>}</div>
        <dl className="an-props" data-testid="an-llm-detail">
          {rows.map(([k, v]) => (
            <div key={k} className="an-llm-prop">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="an-note">{t('reportedNote')}</p>
      </section>
      {g.errorText && (
        <section className="an-panel an-form" aria-labelledby="an-llm-err">
          <h2 id="an-llm-err" className="an-h3">
            {t('errorText')}
          </h2>
          <pre className="an-code an-llm-text">{g.errorText}</pre>
        </section>
      )}
      <section className="an-panel an-form" aria-labelledby="an-llm-in">
        <h2 id="an-llm-in" className="an-h3">
          {t('input')}
        </h2>
        {g.input ? <pre className="an-code an-llm-text">{g.input}</pre> : <p className="an-muted an-small">{t('notSent', { prop: '$ai_input' })}</p>}
      </section>
      <section className="an-panel an-form" aria-labelledby="an-llm-out">
        <h2 id="an-llm-out" className="an-h3">
          {t('output')}
        </h2>
        {g.output ? <pre className="an-code an-llm-text">{g.output}</pre> : <p className="an-muted an-small">{t('notSent', { prop: '$ai_output_choices' })}</p>}
      </section>
    </div>
  );
}
