'use client';

import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { brandOnColor, fmtClock, type RecChapter, type RecOverlay, type RecSegment, type RecCaptionStyle } from '@/lib/rec-schema';
import type { RecBrand } from '@/lib/rec-admin';
import { parseDbUtc } from '@/lib/utils';
import RecPlayer, { type RecMarker, type RecPlayerHandle } from './RecPlayer';
import RecComments, { storedViewerName } from './RecComments';
import RecCopy from './RecCopy';
import RecDownload from './RecDownload';

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
  overlays: RecOverlay[];
  captionStyle?: RecCaptionStyle;
  captionLangs?: string[];
}

/** Variables de la marca para la página compartida (el color ya viene validado). */
export function brandStyle(brand: RecBrand | null | undefined): CSSProperties | undefined {
  if (!brand?.color) return undefined;
  return { ['--rec-brand' as string]: brand.color, ['--rec-brand-on' as string]: brandOnColor(brand.color) };
}

/** Página del video compartido: reproductor, resumen, capítulos, comentarios con tiempo y transcripción. */
export default function RecWatch({ video, shareUrl, member, brand }: { video: RecWatchVideo; shareUrl: string; member: boolean; brand?: RecBrand | null }) {
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
    <main className={`rec-watch${brand ? ' has-brand' : ''}${brand?.color ? ' branded' : ''}`} data-testid="rec-watch" style={brandStyle(brand)}>
      <div className="rec-watch-main">
        {brand && (brand.name || brand.hasLogo) && (
          <div className="rec-brand-bar" data-testid="rec-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo servido por la ruta con permisos */}
            {brand.hasLogo && <img src={`${file}?kind=logo`} alt={brand.name} className="rec-brand-logo" data-testid="rec-brand-logo" />}
            {brand.name && <span className="rec-brand-name">{brand.name}</span>}
          </div>
        )}
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
          overlays={video.overlays}
          captionStyle={video.captionStyle}
          captionLangs={video.captionLangs}
          noDownload={!video.allowDownload && !member}
        />
        <header className="rec-watch-head">
          <h1 className="rec-watch-title">{video.title}</h1>
          <p className="rec-watch-meta muted">
            {video.authorName ? t('byOn', { name: video.authorName, date }) : date}
          </p>
          <div className="rec-watch-actions">
            <RecCopy text={shareUrl} label={t('copyLink')} />
            {(video.allowDownload || member) && (
              <RecDownload url={`${file}?download=1`} label={t('download')} />
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
