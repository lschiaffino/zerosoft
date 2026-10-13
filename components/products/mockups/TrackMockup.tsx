import { useTranslations } from 'next-intl';

/** Punto de color por etiqueta (texto + punto, sin pastillas). */
const LABEL_TONE: Record<FakeIssue['label'], string> = {
  bug: 'is-bad',
  feature: 'is-info',
  design: 'is-accent',
  core: '',
};

interface FakeIssue {
  id: string;
  key: string;
  label: 'bug' | 'feature' | 'design' | 'core';
  who: string;
}

const COLUMNS: { key: string; issues: FakeIssue[] }[] = [
  {
    key: 'backlog',
    issues: [
      { id: 'PAR-118', key: 'c1', label: 'feature', who: 'LB' },
      { id: 'PAR-121', key: 'c2', label: 'feature', who: 'MO' },
    ],
  },
  {
    key: 'todo',
    issues: [
      { id: 'PAR-104', key: 'c3', label: 'design', who: 'FR' },
      { id: 'PAR-097', key: 'c4', label: 'bug', who: 'LB' },
    ],
  },
  {
    key: 'progress',
    issues: [
      { id: 'PAR-133', key: 'c5', label: 'core', who: 'DS' },
      { id: 'PAR-129', key: 'c6', label: 'design', who: 'FR' },
    ],
  },
  {
    key: 'done',
    issues: [{ id: 'PAR-090', key: 'c7', label: 'feature', who: 'MO' }],
  },
];

/** High-fidelity fake of Track: a four-column kanban board. */
export default function TrackMockup() {
  const t = useTranslations('pages.mockups.track');

  return (
    <div className="mk mk-track">
      <div className="mk-track-top">
        <span className="mk-filter">{t('filter')}</span>
        <span className="mk-btn">{t('new')}</span>
      </div>

      <div className="mk-board">
        {COLUMNS.map((col) => (
          <div className="mk-col" key={col.key}>
            <div className="mk-col-head">
              <span>{t(`col_${col.key}`)}</span>
              <span>{col.issues.length}</span>
            </div>
            {col.issues.map((issue) => (
              <div className="mk-issue" key={issue.id}>
                <span className="mk-issue-id">{issue.id}</span>
                <span className="mk-issue-t">{t(`card_${issue.key}`)}</span>
                <span className="mk-issue-foot">
                  <span className={`mk-status ${LABEL_TONE[issue.label]}`}>
                    <i />
                    {t(`label_${issue.label}`)}
                  </span>
                  <span className="mk-ava" aria-hidden="true">
                    {issue.who}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
