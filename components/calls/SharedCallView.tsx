'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SharedCall } from '@/lib/calls/core';
import { clock, useDate, useDuration } from './ui';

/** Lo que ve quien abre el link compartido: grabación, resumen, próximos pasos y transcripción. */
export default function SharedCallView({ call, token }: { call: SharedCall; token: string }) {
  const t = useTranslations('calls.share');
  const tc = useTranslations('calls.call');
  const date = useDate();
  const dur = useDuration();
  const media = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  // El link no trae el tipo de archivo: una grabación sin imagen se ve como barra de audio, no como un recuadro negro.
  const [audioOnly, setAudioOnly] = useState(false);
  const names = useMemo(() => new Map(call.speakers.map((s) => [s.id, s.name])), [call.speakers]);
  const seek = (ms: number) => {
    if (!media.current) return;
    media.current.currentTime = ms / 1000;
    void media.current.play().catch(() => undefined);
  };
  let active = -1;
  for (let i = 0; i < call.transcript.length; i++) if (call.transcript[i].a <= now) active = i;
  return (
    <main className="cl-share" data-testid="calls-shared">
      <header className="cl-share-head">
        <p className="cl-muted">{t('kicker')}</p>
        <h1 className="ui-page-title">{call.title || tc('untitled')}</h1>
        <p className="cl-muted">
          {date(call.at)}
          {call.durationMs > 0 ? ` · ${dur(call.durationMs)}` : ''}
        </p>
      </header>
      {call.hasVideo && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={media}
          className={`cl-player${audioOnly ? ' is-audio-only' : ''}`}
          onLoadedMetadata={(e) => setAudioOnly(e.currentTarget.videoWidth === 0)}
          src={`/api/calls/public/${token}/media`}
          controls
          preload="metadata"
          playsInline
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)}
        />
      )}
      {call.summary && (
        <section>
          <h2 className="cl-h2">{tc('summary')}</h2>
          <p className="cl-prose">{call.summary}</p>
        </section>
      )}
      {call.nextSteps.length > 0 && (
        <section>
          <h2 className="cl-h2">{tc('nextSteps')}</h2>
          <ul className="cl-list">
            {call.nextSteps.map((n, i) => (
              <li key={i}>{n.text}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="cl-h2">{tc('transcript')}</h2>
        <ol className="cl-transcript">
          {call.transcript.map((u, i) => (
            <li key={i} className={`cl-utt${i === active ? ' is-active' : ''}`}>
              <button type="button" className="cl-utt-time" onClick={() => seek(u.a)} aria-label={tc('seekTo', { time: clock(u.a) })}>
                {clock(u.a)}
              </button>
              <div className="cl-utt-body">
                <span className="cl-utt-who">{names.get(u.s) ?? u.s}</span>
                <p>{u.t}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <footer className="cl-share-foot cl-muted">{t('foot')}</footer>
    </main>
  );
}
