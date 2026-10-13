'use client';

import { Link } from '@/i18n/navigation';
import QuickProjectButton from './QuickProjectButton';
import type { TrackProjectWithStats } from '@/lib/track-data';

interface ProjectListProps {
  projects: TrackProjectWithStats[];
  locale: string;
  empty: {
    title: string;
    sub: string;
    cta: string;
  };
  openIssuesLabel: string;
}

export default function ProjectList({ projects, locale, empty, openIssuesLabel }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-zeros mono" aria-hidden>
          0 0 0 0 0
        </p>
        <p className="muted">{empty.sub}</p>
        <QuickProjectButton className="btn btn-solid btn-small" testId="track-new-project-empty" />
      </div>
    );
  }

  return (
    <div className="track-grid">
      {projects.map((p) => (
        <Link key={p.id} href={`/app/track/projects/${p.id}`} className="track-card">
          <div className="track-card-head">
            <span
              className="track-card-icon"
              style={{ background: p.color || '#000000' }}
              aria-hidden
            >
              {p.icon || '◆'}
            </span>
            <span className="track-card-title">{p.name}</span>
          </div>
          {p.description ? <p className="track-card-desc">{p.description}</p> : null}
          <div className="track-card-meta">
            <span>{p.slug}</span>
            <span>
              {p.open_issues} {openIssuesLabel}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
