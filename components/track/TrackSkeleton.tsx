import { useTranslations } from 'next-intl';

/**
 * Carga de Track (loading.tsx): la forma de la página que viene, sin spinner,
 * con las clases ui-skeleton de siempre. Lista (team), issue o project.
 */
export default function TrackSkeleton({ kind }: { kind: 'list' | 'issue' | 'project' }) {
  const t = useTranslations('track.skeleton');
  const rows = (n: number) => Array.from({ length: n }, (_, i) => <span key={i} className="ui-skeleton ui-skeleton-row" />);
  return (
    <div className="app-page track-page ui-page track-skeleton" role="status" aria-label={t('loading')} data-testid="track-skeleton">
      {kind === 'list' && (
        <>
          <span className="ui-skeleton ui-skeleton-title" />
          <div className="ui-loading-stack">{rows(10)}</div>
        </>
      )}
      {kind === 'issue' && (
        <div className="track-skeleton-split">
          <div className="ui-loading-stack">
            <span className="ui-skeleton ui-skeleton-title" />
            <span className="ui-skeleton ui-skeleton-text" />
            <span className="ui-skeleton ui-skeleton-text" />
            {rows(4)}
          </div>
          <div className="ui-loading-stack track-skeleton-side">{rows(6)}</div>
        </div>
      )}
      {kind === 'project' && (
        <>
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-text" />
          <div className="track-skeleton-split">
            <div className="ui-loading-stack">{rows(6)}</div>
            <div className="ui-loading-stack track-skeleton-side">{rows(5)}</div>
          </div>
        </>
      )}
    </div>
  );
}
