import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import QuickProjectButton from './QuickProjectButton';
import PrivateMark from './PrivateMark';
import type { TrackProjectWithStats } from '@/lib/track-data';
import { teamPath } from '@/lib/track-routes';

interface ProjectListProps {
  projects: TrackProjectWithStats[];
  labels: {
    caption: string;
    project: string;
    description: string;
    openIssues: string;
    emptyTitle: string;
    emptyBody: string;
    emptySecondary: string;
    private?: string;
  };
}

/** Proyectos de Track en una tabla densa: nombre, descripción e issues abiertos. */
export default function ProjectList({ projects, labels }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        title={labels.emptyTitle}
        body={labels.emptyBody}
        action={<QuickProjectButton testId="track-new-project-empty" listenParam />}
        secondary={labels.emptySecondary}
      />
    );
  }

  return (
    <DataTable
      caption={labels.caption}
      className="track-projects"
      rows={projects}
      rowKey={(p) => p.id}
      rowHref={(p) => teamPath(p)}
      columns={[
        {
          key: 'name',
          header: labels.project,
          width: '32%',
          cell: (p) => (
            <>
              {p.icon ? <span className="track-project-icon">{p.icon}</span> : null}
              {p.name}
              {p.visibility === 'private' ? <PrivateMark label={labels.private ?? 'Private'} /> : null}
            </>
          ),
        },
        {
          key: 'description',
          header: labels.description,
          cell: (p) => <span className="track-cell-dim track-clamp">{p.description || ''}</span>,
        },
        { key: 'open', header: labels.openIssues, numeric: true, width: '120px', cell: (p) => p.open_issues },
      ]}
    />
  );
}

