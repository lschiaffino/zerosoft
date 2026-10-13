import { useTranslations } from 'next-intl';

const STAGES = [
  { key: 'lead', width: '32%' },
  { key: 'qualified', width: '58%' },
  { key: 'proposal', width: '44%' },
  { key: 'won', width: '100%' },
] as const;

const ROWS = ['r1', 'r2', 'r3', 'r4'] as const;

/** Color del punto de estado por etapa (texto + punto, sin pastillas). */
const STAGE_TONE: Record<(typeof ROWS)[number], string> = {
  r1: 'is-info',
  r2: 'is-warn',
  r3: 'is-ok',
  r4: '',
};

/** High-fidelity fake of CRM: pipeline summary plus contacts table. */
export default function CrmMockup() {
  const t = useTranslations('pages.mockups.crm');

  return (
    <div className="mk mk-crm">
      <div className="mk-head">
        <h4>{t('title')}</h4>
        <span className="mk-btn">{t('new')}</span>
      </div>

      <div className="mk-pipe">
        {STAGES.map((stage) => (
          <div className="mk-stage" key={stage.key}>
            <span className="mk-stage-name">{t(`stage_${stage.key}`)}</span>
            <span className="mk-stage-val">{t(`val_${stage.key}`)}</span>
            <span className="mk-stage-bar" aria-hidden="true">
              <i style={{ width: stage.width }} />
            </span>
          </div>
        ))}
      </div>

      <table className="mk-table">
        <thead>
          <tr>
            <th>{t('thName')}</th>
            <th>{t('thCompany')}</th>
            <th style={{ textAlign: 'right' }}>{t('thValue')}</th>
            <th style={{ textAlign: 'right' }}>{t('thStage')}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r}>
              <td style={{ fontWeight: 500 }}>{t(`${r}name`)}</td>
              <td className="muted">{t(`${r}company`)}</td>
              <td className="mk-mono" style={{ textAlign: 'right' }}>
                {t(`${r}value`)}
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className={`mk-status ${STAGE_TONE[r]}`}>
                  <i />
                  {t(`${r}stage`)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
