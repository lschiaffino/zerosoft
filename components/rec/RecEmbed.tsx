'use client';

import { useCallback } from 'react';
import RecPlayer from './RecPlayer';
import { storedViewerName } from './RecComments';
import type { RecWatchVideo } from './RecWatch';

/** Reproductor insertado: el video, la llamada a la acción y el título con link a la página. */
export default function RecEmbed({ video, shareUrl }: { video: RecWatchVideo; shareUrl: string }) {
  const file = `/api/rec/v/${encodeURIComponent(video.shareId)}/file`;
  const viewerName = useCallback(() => storedViewerName(), []);
  return (
    <main className="rec-embed" data-testid="rec-embed">
      <a className="rec-embed-title" href={shareUrl} target="_blank" rel="noopener noreferrer">
        {video.title}
      </a>
      <RecPlayer
        src={file}
        captionsSrc={video.transcript.length ? `${file}?kind=captions` : null}
        poster={video.hasThumb ? `${file}?kind=thumb` : null}
        title={video.title}
        durationSec={video.durationSec}
        trimStart={video.trimStart}
        trimEnd={video.trimEnd}
        chapters={video.chapters}
        cta={video.ctaLabel && video.ctaUrl ? { label: video.ctaLabel, url: video.ctaUrl, mode: video.ctaMode } : null}
        trackUrl={`/api/rec/v/${encodeURIComponent(video.shareId)}/track`}
        viewerName={viewerName}
        compact
      />
    </main>
  );
}
