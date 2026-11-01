'use client';

import { useCallback } from 'react';
import RecPlayer from './RecPlayer';
import { storedViewerName } from './RecComments';
import { brandStyle, type RecWatchVideo } from './RecWatch';
import type { RecBrand } from '@/lib/rec-admin';

/** Reproductor insertado: el video, la llamada a la acción y el título con link a la página. */
export default function RecEmbed({ video, shareUrl, brand }: { video: RecWatchVideo; shareUrl: string; brand?: RecBrand | null }) {
  const file = `/api/rec/v/${encodeURIComponent(video.shareId)}/file`;
  const viewerName = useCallback(() => storedViewerName(), []);
  return (
    <main className={`rec-embed${brand ? ' has-brand' : ''}${brand?.color ? ' branded' : ''}`} data-testid="rec-embed" style={brandStyle(brand)}>
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
        overlays={video.overlays}
        captionStyle={video.captionStyle}
        captionLangs={video.captionLangs}
        noDownload={!video.allowDownload}
        compact
      />
    </main>
  );
}
