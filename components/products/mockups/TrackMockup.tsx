import { useTranslations } from 'next-intl';

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
      { id: 'ZER-118', key: 'c1', label: 'feature', who: 'AL' },
      { id: 'ZER-121', key: 'c2', label: 'feature', who: 'MS' },
    ],
  },
  {
    key: 'todo',
    issues: [
      { id: 'ZER-104', key: 'c3', label: 'design', who: 'JD' },
      { id: 'ZER-097', key: 'c4', label: 'bug', who: 'AL' },
    ],
  },
  {
    key: 'progress',
    issues: [
      { id: 'ZER-133', key: 'c5', label: 'core', who: 'RK' },
      { id: 'ZER-129', key: 'c6', label: 'design', who: 'MS' },
    ],
  },
  {
    key: 'done',
    issues: [{ id: 'ZER-090', key: 'c7', label: 'core', who: 'JD' }],
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
                  <span className={`mk-label mk-label-${issue.label}`}>
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
