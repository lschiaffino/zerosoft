'use client';

import { useCallback, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { fmtClock, type RecChapter, type RecSegment } from '@/lib/rec-schema';
import { parseDbUtc } from '@/lib/utils';
import RecPlayer, { type RecMarker, type RecPlayerHandle } from './RecPlayer';
import RecComments, { storedViewerName } from './RecComments';
import RecCopy from './RecCopy';

export interface RecWatchVideo {
  shareId: string;
  title: string;
  description: string;
  summary: string;
  chapters: RecChapter[];
  transcript: RecSegment[];
  authorName: string;
  createdAt: string;
  durationSec: number;
  trimStart: number;
  trimEnd: number | null;
  allowDownload: boolean;
  allowComments: boolean;
  ctaLabel: string;
  ctaUrl: string;
  ctaMode: 'always' | 'end';
  hasThumb: boolean;
}

/** Página del video compartido: reproductor, resumen, capítulos, comentarios con tiempo y transcripción. */
export default function RecWatch({ video, shareUrl, member }: { video: RecWatchVideo; shareUrl: string; member: boolean }) {
  const t = useTranslations('rec.watch');
  const locale = useLocale();
  const player = useRef<RecPlayerHandle>(null);
  const [markers, setMarkers] = useState<RecMarker[]>([]);
  const [tab, setTab] = useState<'comments' | 'transcript'>('comments');
  const [now, setNow] = useState(0);
  const file = `/api/rec/v/${encodeURIComponent(video.shareId)}/file`;
  const seek = useCallback((rel: number) => player.current?.seek(rel), []);
  const viewerName = useCallback(() => storedViewerName(), []);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(video.createdAt));

  return (
    <main className="rec-watch" data-testid="rec-watch">
      <div className="rec-watch-main">
        <RecPlayer
          ref={player}
          src={file}
          captionsSrc={video.transcript.length ? `${file}?kind=captions` : null}
          poster={video.hasThumb ? `${file}?kind=thumb` : null}
          title={video.title}
          durationSec={video.durationSec}
          trimStart={video.trimStart}
          trimEnd={video.trimEnd}
          chapters={video.chapters}
          markers={markers}
          cta={video.ctaLabel && video.ctaUrl ? { label: video.ctaLabel, url: video.ctaUrl, mode: video.ctaMode } : null}
          trackUrl={`/api/rec/v/${encodeURIComponent(video.shareId)}/track`}
          viewerName={viewerName}
          onTime={setNow}
        />
        <header className="rec-watch-head">
          <h1 className="rec-watch-title">{video.title}</h1>
          <p className="rec-watch-meta muted">
            {video.authorName ? t('byOn', { name: video.authorName, date }) : date}
          </p>
          <div className="rec-watch-actions">
            <RecCopy text={shareUrl} label={t('copyLink')} />
            {(video.allowDownload || member) && (
              <a className="btn btn-secondary btn-sm" href={`${file}?download=1`} download>
                {t('download')}
              </a>
            )}
          </div>
        </header>
        {video.summary && (
          <section className="rec-watch-section">
            <h2 className="rec-h">{t('summary')}</h2>
            <p className="rec-prose">{video.summary}</p>
          </section>
        )}
        {video.description && (
          <section className="rec-watch-section">
            <h2 className="rec-h">{t('description')}</h2>
            <p className="rec-prose">{video.description}</p>
          </section>
        )}
        {video.chapters.length > 0 && (
          <section className="rec-watch-section">
            <h2 className="rec-h">{t('chapters')}</h2>
            <ol className="rec-chapters">
              {video.chapters.map((c) => (
                <li key={c.start}>
                  <button type="button" className="rec-chapter" onClick={() => seek(c.start - video.trimStart)}>
                    <span className="data">{fmtClock(Math.max(0, c.start - video.trimStart))}</span>
                    <span>{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
      <aside className="rec-watch-side">
        <div className="ui-tabs" role="tablist" aria-label={t('panel')}>
          <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'comments'} onClick={() => setTab('comments')}>
            {t('comments')}
          </button>
          <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>
            {t('transcript')}
          </button>
        </div>
        <div hidden={tab !== 'comments'} role="tabpanel">
          <RecComments
            shareId={video.shareId}
            trimStart={video.trimStart}
            allowComments={video.allowComments}
            canModerate={member}
            currentAbs={() => video.trimStart + (player.current?.current() ?? 0)}
            onSeek={seek}
            onMarkers={setMarkers}
          />
        </div>
        <div hidden={tab !== 'transcript'} role="tabpanel">
          <RecTranscript segments={video.transcript} trimStart={video.trimStart} trimEnd={video.trimEnd} now={now} onSeek={seek} emptyText={t('noTranscript')} />
        </div>
      </aside>
    </main>
  );
}

/** Transcripción clicable: el segmento actual queda marcado. */
export function RecTranscript({
  segments,
  trimStart,
  trimEnd,
  now,
  onSeek,
  emptyText,
}: {
  segments: RecSegment[];
  trimStart: number;
  trimEnd: number | null;
  now: number;
  onSeek: (rel: number) => void;
  emptyText: string;
}) {
  const shown = segments.filter((s) => s.end > trimStart && (trimEnd === null || s.start < trimEnd));
  if (!shown.length) return <p className="ui-help">{emptyText}</p>;
  const abs = now + trimStart;
  return (
    <ol className="rec-transcript" data-testid="rec-transcript">
      {shown.map((s, i) => {
        const active = abs >= s.start && abs < s.end;
        return (
          <li key={i}>
            <button type="button" className={`rec-seg${active ? ' active' : ''}`} onClick={() => onSeek(Math.max(0, s.start - trimStart))} aria-current={active || undefined}>
              <span className="data">{fmtClock(Math.max(0, s.start - trimStart))}</span>
              <span>{s.text}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
