import { useTranslations } from 'next-intl';

const RUNS = ['run1', 'run2', 'run3'] as const;

/**
 * Vista de Flow: un disparador, una condición con dos ramas y las últimas
 * corridas. Los nodos son HTML; las conexiones, un SVG detrás.
 */
export default function FlowMockup() {
  const t = useTranslations('pages.mockups.flow');

  return (
    <div className="mk mk-flow">
      <div className="mk-flow-canvas">
        <svg className="mk-flow-lines" viewBox="0 0 460 400" preserveAspectRatio="none" aria-hidden="true">
          <path d="M230 64 V118" />
          <path d="M230 166 V212" />
          <path d="M230 260 C230 300 115 290 115 330" />
          <path d="M230 260 C230 300 345 290 345 330" />
        </svg>
        <div className="mk-node mk-node-trigger" style={{ left: 120, top: 16 }}>
          <span className="mk-node-k">{t('triggerK')}</span>
          {t('trigger')}
        </div>
        <div className="mk-node" style={{ left: 120, top: 118 }}>
          <span className="mk-node-k">CRM</span>
          {t('step1')}
        </div>
        <div className="mk-node mk-node-if" style={{ left: 120, top: 212 }}>
          <span className="mk-node-k">{t('ifK')}</span>
          {t('cond')}
        </div>
        <div className="mk-node" style={{ left: 10, top: 330 }}>
          <span className="mk-node-k">{t('yes')} · Email</span>
          {t('yesStep')}
        </div>
        <div className="mk-node" style={{ left: 240, top: 330 }}>
          <span className="mk-node-k">{t('no')} · Track</span>
          {t('noStep')}
        </div>
      </div>

      <aside className="mk-flow-runs">
        <p className="mk-agents-h">{t('runsTitle')}</p>
        {RUNS.map((r, i) => (
          <div className="mk-flow-run" key={r}>
            <span className={`mk-status ${i === 2 ? 'is-bad' : 'is-ok'}`}>
              <i />
              {t(`${r}`)}
            </span>
            <span className="mk-mono">{t(`${r}time`)}</span>
          </div>
        ))}
      </aside>
    </div>
  );
}
