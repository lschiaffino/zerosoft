'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import TitleInput from '@/components/ui/TitleInput';
import type { CallDetail, ClipDto, CommentDto } from '@/lib/calls/core';
import type { Speaker } from '@/lib/calls/types';
import { api, CallsDialog, clock, MOVING, StatusBadge, useDate, useDuration, useErrorText, useToast } from './ui';

type Tab = 'summary' | 'insights' | 'comments' | 'clips' | 'ask';

function parseClock(raw: string): number | null {
  const parts = raw.trim().split(':').map((x) => Number(x));
  if (!parts.length || parts.some((x) => !Number.isFinite(x) || x < 0)) return null;
  return parts.reduce((s, x) => s * 60 + x, 0) * 1000;
}

/**
 * Una llamada: grabación, transcripción sincronizada con hablantes (clic para
 * saltar), y al costado resumen, análisis, comentarios con momento, clips y
 * preguntas. Mientras el bot graba o se procesa, se actualiza sola.
 */
export default function CallView({ initial, crmEnabled, initialSeconds, initialClip }: { initial: CallDetail; crmEnabled: boolean; initialSeconds: number | null; initialClip: string | null }) {
  const t = useTranslations('calls.call');
  const tc = useTranslations('calls');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const dur = useDuration();
  const err = useErrorText();
  const [toast, push] = useToast();
  const [call, setCall] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [tab, setTab] = useState<Tab>(initialClip ? 'clips' : 'summary');
  const [now, setNow] = useState(0);
  const [follow, setFollow] = useState(true);
  const [find, setFind] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const clipEnd = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);

  const speakers = useMemo(() => new Map(call.speakers.map((s) => [s.id, s])), [call.speakers]);
  const live = MOVING.includes(call.status);

  // En curso: se vuelve a pedir la llamada cada 4 s (con la pestaña visible).
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await api<{ call?: CallDetail }>(`/api/calls/calls/${call.id}`);
      if (res.ok && res.data.call) setCall(res.data.call);
    }, 4000);
    return () => window.clearInterval(id);
  }, [live, call.id]);

  const seek = useCallback((ms: number, play = true) => {
    const el = media.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
    setNow(ms);
    setFollow(true);
    if (play) void el.play().catch(() => undefined);
  }, []);

  // ?t= (segundos) y ?clip= al abrir.
  useEffect(() => {
    const el = media.current;
    if (!el) return;
    const clip = initialClip ? call.clips.find((c) => c.id === initialClip) : null;
    const start = clip ? clip.startMs : initialSeconds !== null ? initialSeconds * 1000 : null;
    if (start === null) return;
    clipEnd.current = clip ? clip.endMs : null;
    const go = () => {
      el.currentTime = start / 1000;
      setNow(start);
    };
    if (el.readyState >= 1) go();
    else el.addEventListener('loadedmetadata', go, { once: true });
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTime = () => {
    const el = media.current;
    if (!el) return;
    const ms = el.currentTime * 1000;
    setNow(ms);
    if (clipEnd.current !== null && ms >= clipEnd.current) {
      el.pause();
      clipEnd.current = null;
    }
  };

  const activeIndex = useMemo(() => {
    let lo = 0;
    let hi = call.transcript.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (call.transcript[mid].a <= now) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }, [call.transcript, now]);

  // Seguir lo que se dice: la línea activa queda a la vista (si la persona no scrolleó a mano).
  useEffect(() => {
    if (!follow || activeIndex < 0 || !media.current || media.current.paused) return;
    const el = transcriptRef.current?.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex, follow]);

  const patch = async (body: Record<string, unknown>, okMsg?: string) => {
    const res = await api<{ call?: CallDetail }>(`/api/calls/calls/${call.id}`, { method: 'PATCH', json: body });
    if (!res.ok || !res.data.call) {
      push(err(res.data.error), 'bad');
      return false;
    }
    setCall(res.data.call);
    if (okMsg) push(okMsg);
    return true;
  };

  const saveTitle = async () => {
    const next = title.trim();
    if (!next) return setTitle(call.title);
    if (next === call.title) return;
    if (await patch({ title: next }, t('renamed'))) router.refresh();
  };

  const remove = async () => {
    setBusy(true);
    const res = await api(`/api/calls/calls/${call.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return push(err(res.data.error), 'bad');
    setConfirmDelete(false);
    router.push('/app/calls');
    router.refresh();
  };

  const stop = async () => {
    setBusy(true);
    const res = await api(`/api/calls/calls/${call.id}/stop`, { method: 'POST' });
    setBusy(false);
    setConfirmStop(false);
    if (!res.ok) return push(err(res.data.error), 'bad');
    push(t('stopped'));
    const fresh = await api<{ call?: CallDetail }>(`/api/calls/calls/${call.id}`);
    if (fresh.data.call) setCall(fresh.data.call);
  };

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return call.transcript.map((u, i) => ({ u, i, hit: q ? u.t.toLowerCase().includes(q) : false })).filter((x) => !find.trim() || x.hit);
  }, [call.transcript, find]);

  const commentAt = (ms: number) => {
    setTab('comments');
    window.dispatchEvent(new CustomEvent('cl:comment-at', { detail: ms }));
  };
  const clipFrom = (ms: number) => {
    setTab('clips');
    window.dispatchEvent(new CustomEvent('cl:clip-from', { detail: ms }));
  };

  const isAudio = (call.mediaMime ?? '').startsWith('audio/');
  const tabs: Array<[Tab, string, number?]> = [
    ['summary', t('tabs.summary')],
    ['insights', t('tabs.insights')],
    ['comments', t('tabs.comments'), call.comments.length],
    ['clips', t('tabs.clips'), call.clips.length],
    ['ask', t('tabs.ask')],
  ];

  return (
    <div className="app-page ui-page cl-page cl-call" data-testid="calls-call">
      {toast}
      <header className="ui-page-header cl-call-head">
        <div className="ui-page-header-text">
          <Link href="/app/calls" className="ui-page-back">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            {t('back')}
          </Link>
          {call.canEdit ? (
            <TitleInput
              className="ui-title-input ui-page-title"
              value={title}
              onValueChange={setTitle}
              onBlur={() => void saveTitle()}
              aria-label={t('rename')}
              maxLength={200}
              data-testid="calls-title"
            />
          ) : (
            <h1 className="ui-page-title">{call.title || t('untitled')}</h1>
          )}
          <p className="ui-page-desc cl-call-meta">
            <StatusBadge status={call.status} />
            <span>{date(call.at)}</span>
            {call.durationMs > 0 && <span>{dur(call.durationMs)}</span>}
            {call.ownerName && <span>{call.ownerName}</span>}
            {call.deal && (
              <Link href={`/app/crm/deals/${call.deal.id}`} className="cl-deal-link">
                {call.deal.name}
              </Link>
            )}
          </p>
        </div>
        <div className="ui-page-actions">
          {live && call.canEdit && (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmStop(true)} data-testid="calls-stop">
              {t('stop')}
            </button>
          )}
          {call.status === 'ready' && call.canEdit && (
            <button type="button" className="btn btn-secondary" onClick={() => setShareOpen(true)} data-testid="calls-share">
              {t('share')}
            </button>
          )}
          {call.status === 'ready' && (
            <details className="cl-menu">
              <summary className="btn btn-ghost">{t('export')}</summary>
              <div className="cl-menu-list" role="menu">
                {(['md', 'txt', 'vtt', 'json'] as const).map((f) => (
                  <a key={f} role="menuitem" href={`/api/calls/calls/${call.id}/export?format=${f}&locale=${locale}`} download>
                    {t(`exportAs.${f}`)}
                  </a>
                ))}
              </div>
            </details>
          )}
          {call.canEdit && (
            <button type="button" className="btn btn-ghost cl-danger" onClick={() => setConfirmDelete(true)} data-testid="calls-delete">
              {t('delete')}
            </button>
          )}
        </div>
      </header>

      {live && (
        <div className="cl-live" role="status" data-testid="calls-live">
          <i className="cl-rec-dot" aria-hidden="true" />
          <div>
            <strong>{tc(`status.${call.status}`)}</strong>
            <p>{t(`liveBody.${call.status}`)}</p>
          </div>
        </div>
      )}
      {call.status === 'failed' && (
        <div className="cl-alert" role="alert">
          <strong>{t('failedTitle')}</strong>
          <p>{err(call.error)}</p>
        </div>
      )}
      {call.status === 'ready' && call.error && call.error !== 'no_speech' && (
        <p className="cl-note" role="status">
          {err(call.error)}
        </p>
      )}

      <div className="cl-call-grid">
        <section className="cl-main" aria-label={t('recording')}>
          {call.hasVideo ? (
            isAudio ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio ref={media} className="cl-player cl-player-audio" src={`/api/calls/calls/${call.id}/media`} controls preload="metadata" onTimeUpdate={onTime} data-testid="calls-player" />
            ) : (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video ref={media} className="cl-player" src={`/api/calls/calls/${call.id}/media`} controls preload="metadata" playsInline onTimeUpdate={onTime} data-testid="calls-player" />
            )
          ) : (
            call.status === 'ready' && <p className="cl-note">{t('noRecording')}</p>
          )}
          {call.transcript.length > 0 && call.durationMs > 0 && <SpeakerTracks call={call} now={now} onSeek={seek} />}

          <div className="cl-transcript-head">
            <h2 className="cl-h2">{t('transcript')}</h2>
            {call.transcript.length > 0 && (
              <input className="input cl-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('searchTranscript')} aria-label={t('searchTranscript')} data-testid="calls-transcript-search" />
            )}
          </div>
          {call.transcript.length === 0 ? (
            <p className="cl-muted">{call.status === 'ready' ? t('noTranscript') : t('transcriptLater')}</p>
          ) : shown.length === 0 ? (
            <p className="cl-muted">{t('noTranscriptMatch')}</p>
          ) : (
            <ol className="cl-transcript" ref={transcriptRef} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)} data-testid="calls-transcript">
              {shown.map(({ u, i }) => {
                const s = speakers.get(u.s);
                return (
                  <li key={i} data-i={i} className={`cl-utt${i === activeIndex ? ' is-active' : ''}${s?.side === 'internal' ? ' is-internal' : ''}`}>
                    <button type="button" className="cl-utt-time" onClick={() => seek(u.a)} aria-label={t('seekTo', { time: clock(u.a) })} data-testid="calls-utt-seek">
                      {clock(u.a)}
                    </button>
                    <div className="cl-utt-body">
                      <span className="cl-utt-who">{s?.name ?? u.s}</span>
                      <p>{u.t}</p>
                    </div>
                    <span className="cl-utt-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => commentAt(u.a)}>
                        {t('commentHere')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => clipFrom(u.a)}>
                        {t('clipHere')}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="cl-side" aria-label={t('details')}>
          <div className="ui-tabs" role="tablist" aria-label={t('details')}>
            {tabs.map(([key, label, count]) => (
              <button key={key} type="button" role="tab" className="ui-tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`calls-tab-${key}`}>
                {label}
                {count ? <span className="ui-tab-count">{count}</span> : null}
              </button>
            ))}
          </div>
          <div className="cl-side-body" role="tabpanel">
            {tab === 'summary' && <SummaryPanel call={call} onSeek={seek} crmEnabled={crmEnabled} onPatch={patch} />}
            {tab === 'insights' && <InsightsPanel call={call} onSeek={seek} onPatch={patch} onReanalyzed={(a) => setCall({ ...call, analysis: a })} />}
            {tab === 'comments' && <CommentsPanel call={call} now={now} onSeek={seek} onChange={(comments) => setCall({ ...call, comments })} />}
            {tab === 'clips' && (
              <ClipsPanel
                call={call}
                now={now}
                onPlay={(c) => {
                  clipEnd.current = c.endMs;
                  seek(c.startMs);
                }}
                onChange={(clips) => setCall({ ...call, clips })}
              />
            )}
            {tab === 'ask' && <AskPanel call={call} onSeek={seek} />}
          </div>
        </aside>
      </div>

      <ShareDialog open={shareOpen} call={call} onClose={() => setShareOpen(false)} onChange={(token) => setCall({ ...call, shared: Boolean(token), shareToken: token })} />
      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteTitle')}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={confirmStop}
        title={t('stopTitle')}
        body={t('stopBody')}
        confirmLabel={t('stop')}
        cancelLabel={t('cancel')}
        busy={busy}
        onConfirm={() => void stop()}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}

/** Una pista por hablante con sus tramos: clic para saltar. */
function SpeakerTracks({ call, now, onSeek }: { call: CallDetail; now: number; onSeek: (ms: number) => void }) {
  const t = useTranslations('calls.call');
  const total = Math.max(call.durationMs, call.transcript[call.transcript.length - 1]?.b ?? 1);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  return (
    <div className="cl-tracks" aria-label={t('speakers')}>
      {call.speakers.map((s) => (
        <div key={s.id} className={`cl-track${s.side === 'internal' ? ' is-internal' : ''}`}>
          <span className="cl-track-name">{s.name}</span>
          <div className="cl-track-bar">
            {call.transcript
              .filter((u) => u.s === s.id)
              .map((u, i) => (
                <button key={i} type="button" tabIndex={-1} aria-hidden="true" className="cl-track-seg" style={{ left: pct(u.a), width: `max(2px, ${pct(u.b - u.a)})` }} onClick={() => onSeek(u.a)} />
              ))}
            <span className="cl-track-now" style={{ left: pct(now) }} aria-hidden="true" />
          </div>
        </div>
      ))}
      {call.comments.some((c) => c.atMs !== null) && (
        <div className="cl-track cl-track-comments">
          <span className="cl-track-name">{t('tabs.comments')}</span>
          <div className="cl-track-bar">
            {call.comments
              .filter((c) => c.atMs !== null)
              .map((c) => (
                <button key={c.id} type="button" className="cl-track-pin" style={{ left: pct(c.atMs!) }} onClick={() => onSeek(c.atMs!)} aria-label={`${clock(c.atMs!)} ${c.authorName}`} title={c.body.slice(0, 80)} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeLink({ ms, onSeek }: { ms: number; onSeek: (ms: number) => void }) {
  return (
    <button type="button" className="cl-time" onClick={() => onSeek(ms)}>
      {clock(ms)}
    </button>
  );
}

function SummaryPanel({ call, onSeek, crmEnabled, onPatch }: { call: CallDetail; onSeek: (ms: number) => void; crmEnabled: boolean; onPatch: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const t = useTranslations('calls.call');
  const a = call.analysis;
  return (
    <div className="cl-stack" data-testid="calls-summary">
      {crmEnabled && call.canEdit && <DealPicker call={call} onPatch={onPatch} />}
      {!a ? (
        <p className="cl-muted">{call.status === 'ready' ? t('noAnalysis') : t('analysisLater')}</p>
      ) : (
        <>
          <section>
            <h3 className="cl-h3">{t('summary')}</h3>
            <p className="cl-prose">{a.summary}</p>
          </section>
          <section>
            <h3 className="cl-h3">{t('nextSteps')}</h3>
            {a.nextSteps.length ? (
              <ul className="cl-list">
                {a.nextSteps.map((n, i) => (
                  <li key={i}>
                    {n.text}
                    {(n.owner || n.due) && <span className="cl-muted"> · {[n.owner, n.due].filter(Boolean).join(', ')}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cl-muted">{t('noNextSteps')}</p>
            )}
          </section>
          {a.topics.length > 0 && (
            <section>
              <h3 className="cl-h3">{t('topics')}</h3>
              <ul className="cl-list cl-list-timed">
                {a.topics.map((x, i) => (
                  <li key={i}>
                    <TimeLink ms={x.startMs} onSeek={onSeek} /> {x.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {(call.attendees.length > 0 || call.participants.length > 0) && (
        <section>
          <h3 className="cl-h3">{t('attendees')}</h3>
          <ul className="cl-list">
            {call.attendees.map((p) => (
              <li key={p.email} className="cl-wrap">
                {p.name ? `${p.name} · ` : ''}
                {p.email}
              </li>
            ))}
            {call.attendees.length === 0 && call.participants.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function DealPicker({ call, onPatch }: { call: CallDetail; onPatch: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const t = useTranslations('calls.call');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(async () => {
      const res = await api<{ deals?: Array<{ id: string; name: string }> }>(`/api/calls/deals?q=${encodeURIComponent(q)}`);
      setOptions(res.data.deals ?? []);
    }, 200);
    return () => window.clearTimeout(id);
  }, [open, q]);
  return (
    <section className="cl-deal">
      <h3 className="cl-h3">{t('deal')}</h3>
      {call.deal ? (
        <p className="cl-deal-row">
          <Link href={`/app/crm/deals/${call.deal.id}`}>{call.deal.name}</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onPatch({ dealId: null }, t('dealUnlinked'))}>
            {t('unlink')}
          </button>
        </p>
      ) : (
        !open && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)} data-testid="calls-link-deal">
            {t('linkDeal')}
          </button>
        )
      )}
      {!call.deal && open && (
        <div className="cl-deal-search">
          <input className="input" autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dealSearch')} aria-label={t('dealSearch')} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
          {options === null ? null : options.length === 0 ? (
            <p className="cl-muted">{t('dealNone')}</p>
          ) : (
            <ul className="cl-picklist">
              {options.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await onPatch({ dealId: d.id }, t('dealLinked'))) setOpen(false);
                    }}
                  >
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {call.crmActivityId && <p className="cl-muted">{t('crmLogged')}</p>}
    </section>
  );
}

function InsightsPanel({ call, onSeek, onPatch, onReanalyzed }: { call: CallDetail; onSeek: (ms: number) => void; onPatch: (b: Record<string, unknown>, ok?: string) => Promise<boolean>; onReanalyzed: (a: CallDetail['analysis']) => void }) {
  const t = useTranslations('calls.call');
  const tm = useTranslations('calls.methodology');
  const dur = useDuration();
  const err = useErrorText();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const m = call.metrics;
  const a = call.analysis;
  const reanalyze = async () => {
    setBusy(true);
    setMsg(null);
    const res = await api<{ analysis?: CallDetail['analysis'] }>(`/api/calls/calls/${call.id}/reanalyze`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) return setMsg(err(res.data.error));
    onReanalyzed(res.data.analysis ?? null);
  };
  if (!m) return <p className="cl-muted">{t('analysisLater')}</p>;
  return (
    <div className="cl-stack" data-testid="calls-insights">
      <section>
        <h3 className="cl-h3">{t('talkRatio')}</h3>
        {m.talkRatio !== null ? (
          <div className="cl-ratio" aria-label={`${t('talkRatio')}: ${Math.round(m.talkRatio * 100)}%`}>
            <div className="cl-ratio-bar">
              <span style={{ width: `${Math.round(m.talkRatio * 100)}%` }} />
            </div>
            <p className="cl-ratio-legend">
              <span>
                {t('sides.internal')} {Math.round(m.talkRatio * 100)}%
              </span>
              <span>
                {t('sides.external')} {100 - Math.round(m.talkRatio * 100)}%
              </span>
            </p>
          </div>
        ) : (
          <p className="cl-muted">{t('noSides')}</p>
        )}
        <dl className="cl-stats">
          <div>
            <dt>{t('longestMonologue')}</dt>
            <dd>{m.longestMonologue ? <button type="button" className="cl-time" onClick={() => onSeek(m.longestMonologue!.startMs)}>{dur(m.longestMonologue.ms)}</button> : '–'}</dd>
          </div>
          <div>
            <dt>{t('longestStory')}</dt>
            <dd>{m.longestCustomerStory ? <button type="button" className="cl-time" onClick={() => onSeek(m.longestCustomerStory!.startMs)}>{dur(m.longestCustomerStory.ms)}</button> : '–'}</dd>
          </div>
          <div>
            <dt>{t('interactivity')}</dt>
            <dd>{m.interactivity}</dd>
          </div>
          <div>
            <dt>{t('patience')}</dt>
            <dd>{m.patienceMs === null ? '–' : `${(m.patienceMs / 1000).toFixed(1)} s`}</dd>
          </div>
          <div>
            <dt>{t('questionsAsked')}</dt>
            <dd>{m.questionsInternal}</dd>
          </div>
        </dl>
      </section>
      <SpeakersEditor call={call} onPatch={onPatch} />
      {a && (
        <>
          <section>
            <h3 className="cl-h3">
              {t('scorecard')} · {tm(`name.${a.scorecard.methodology}`)} <span className="cl-score">{a.scorecard.total}%</span>
            </h3>
            <ul className="cl-scorecard">
              {a.scorecard.items.map((i) => (
                <li key={i.key}>
                  <div className="cl-score-row">
                    <span>{tm.has(`criteria.${i.key}`) ? tm(`criteria.${i.key}`) : i.label}</span>
                    <span className="cl-score-dots" aria-label={`${i.score}/5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <i key={n} className={n <= i.score ? 'on' : ''} />
                      ))}
                    </span>
                  </div>
                  {i.evidence && (
                    <p className="cl-muted">
                      {i.atMs !== null && <TimeLink ms={i.atMs} onSeek={onSeek} />} {i.evidence}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <TimedList title={t('questions')} empty={t('noQuestions')} items={a.questions.map((q) => ({ at: q.atMs, text: q.text, who: q.speaker }))} onSeek={onSeek} />
          <TimedList
            title={t('objections')}
            empty={t('noObjections')}
            items={a.objections.map((o) => ({ at: o.atMs, text: o.text, who: o.speaker, extra: o.response ? `${t('response')}: ${o.response}` : t('noResponse') }))}
            onSeek={onSeek}
          />
          <TimedList title={t('competitors')} empty={t('noCompetitors')} items={a.competitors.map((c) => ({ at: c.atMs, text: c.quote, who: c.name }))} onSeek={onSeek} />
          {a.risks.length > 0 && (
            <section>
              <h3 className="cl-h3">{t('risks')}</h3>
              <ul className="cl-list">
                {a.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {call.canEdit && call.status === 'ready' && call.transcript.length > 0 && (
        <section>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reanalyze()} disabled={busy} data-testid="calls-reanalyze">
            {busy ? t('reanalyzing') : t('reanalyze')}
          </button>
          {msg && (
            <p className="ui-error" role="alert">
              {msg}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function TimedList({ title, empty, items, onSeek }: { title: string; empty: string; items: Array<{ at: number; text: string; who: string; extra?: string }>; onSeek: (ms: number) => void }) {
  return (
    <section>
      <h3 className="cl-h3">
        {title} {items.length > 0 && <span className="cl-count">{items.length}</span>}
      </h3>
      {items.length === 0 ? (
        <p className="cl-muted">{empty}</p>
      ) : (
        <ul className="cl-list cl-list-timed">
          {items.map((x, i) => (
            <li key={i}>
              <TimeLink ms={x.at} onSeek={onSeek} /> <strong>{x.who}</strong> {x.text}
              {x.extra && <span className="cl-muted cl-block">{x.extra}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SpeakersEditor({ call, onPatch }: { call: CallDetail; onPatch: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const t = useTranslations('calls.call');
  const dur = useDuration();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const share = new Map(call.metrics?.bySpeaker.map((b) => [b.id, b]) ?? []);
  const save = async (s: Speaker) => {
    const name = value.trim();
    setEditing(null);
    if (name && name !== s.name) await onPatch({ speakers: [{ id: s.id, name }] }, t('speakerSaved'));
  };
  return (
    <section>
      <h3 className="cl-h3">{t('speakers')}</h3>
      <ul className="cl-speakers">
        {call.speakers.map((s) => (
          <li key={s.id}>
            {editing === s.id ? (
              <input
                className="input"
                autoFocus
                value={value}
                maxLength={120}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => void save(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save(s);
                  if (e.key === 'Escape') setEditing(null);
                }}
                aria-label={t('renameSpeaker')}
              />
            ) : (
              <span className="cl-speaker-name">{s.name}</span>
            )}
            <span className="cl-muted">
              {share.get(s.id) ? `${Math.round((share.get(s.id)!.share || 0) * 100)}% · ${dur(share.get(s.id)!.ms)}` : ''}
            </span>
            {call.canEdit && (
              <span className="cl-speaker-actions">
                <select
                  className="select"
                  value={s.side}
                  onChange={(e) => void onPatch({ speakers: [{ id: s.id, side: e.target.value }] })}
                  aria-label={t('side', { name: s.name })}
                >
                  <option value="internal">{t('sides.internal')}</option>
                  <option value="external">{t('sides.external')}</option>
                </select>
                {editing !== s.id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setValue(s.name);
                      setEditing(s.id);
                    }}
                  >
                    {t('renameSpeaker')}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommentsPanel({ call, now, onSeek, onChange }: { call: CallDetail; now: number; onSeek: (ms: number) => void; onChange: (c: CommentDto[]) => void }) {
  const t = useTranslations('calls.call');
  const err = useErrorText();
  const date = useDate();
  const [body, setBody] = useState('');
  const [at, setAt] = useState<number | null>(call.hasVideo ? Math.round(now) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const on = (e: Event) => {
      setAt((e as CustomEvent<number>).detail);
      ref.current?.focus();
    };
    window.addEventListener('cl:comment-at', on);
    return () => window.removeEventListener('cl:comment-at', on);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    const res = await api<{ comment?: CommentDto }>(`/api/calls/calls/${call.id}/comments`, { method: 'POST', json: { body: body.trim(), atMs: at } });
    setBusy(false);
    if (!res.ok || !res.data.comment) return setError(err(res.data.error));
    setBody('');
    onChange([...call.comments, res.data.comment].sort((x, y) => (x.atMs ?? 9e15) - (y.atMs ?? 9e15)));
  };
  const remove = async (id: string) => {
    const res = await api(`/api/calls/calls/${call.id}/comments/${id}`, { method: 'DELETE' });
    if (!res.ok) return setError(err(res.data.error));
    onChange(call.comments.filter((c) => c.id !== id));
  };
  return (
    <div className="cl-stack" data-testid="calls-comments">
      <form onSubmit={submit} className="cl-form">
        <textarea
          ref={ref}
          className="textarea"
          rows={3}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
          placeholder={t('commentPlaceholder')}
          aria-label={t('commentPlaceholder')}
          data-testid="calls-comment-body"
        />
        <div className="cl-row">
          <label className="ui-check">
            <input type="checkbox" checked={at !== null} onChange={(e) => setAt(e.target.checked ? Math.round(now) : null)} />
            {at !== null ? t('commentAt', { time: clock(at) }) : t('commentGeneral')}
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim()} data-testid="calls-comment-post">
            {t('commentPost')}
          </button>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {call.comments.length === 0 ? (
        <p className="cl-muted">{t('commentsEmpty')}</p>
      ) : (
        <ul className="cl-comments">
          {call.comments.map((c) => (
            <li key={c.id} data-testid="calls-comment">
              <div className="cl-comment-head">
                {c.atMs !== null && <TimeLink ms={c.atMs} onSeek={onSeek} />}
                <strong>{c.authorName}</strong>
                <span className="cl-muted">{date(c.createdAt)}</span>
                {c.canDelete && (
                  <button type="button" className="btn btn-ghost btn-sm cl-push" onClick={() => void remove(c.id)} aria-label={t('commentDelete')}>
                    {t('commentDelete')}
                  </button>
                )}
              </div>
              <p className="cl-prose">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClipsPanel({ call, now, onPlay, onChange }: { call: CallDetail; now: number; onPlay: (c: ClipDto) => void; onChange: (c: ClipDto[]) => void }) {
  const t = useTranslations('calls.call');
  const err = useErrorText();
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState(clock(now));
  const [to, setTo] = useState(clock(now + 30_000));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const ms = (e as CustomEvent<number>).detail;
      setFrom(clock(ms));
      setTo(clock(ms + 30_000));
      titleRef.current?.focus();
    };
    window.addEventListener('cl:clip-from', on);
    return () => window.removeEventListener('cl:clip-from', on);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const startMs = parseClock(from);
    const endMs = parseClock(to);
    if (startMs === null || endMs === null || endMs <= startMs) return setError(err('invalid_clip'));
    setBusy(true);
    setError(null);
    const res = await api<{ clip?: ClipDto }>(`/api/calls/calls/${call.id}/clips`, { method: 'POST', json: { title: title.trim(), startMs, endMs } });
    setBusy(false);
    if (!res.ok || !res.data.clip) return setError(err(res.data.error));
    setTitle('');
    onChange([...call.clips, res.data.clip].sort((x, y) => x.startMs - y.startMs));
  };
  const remove = async (id: string) => {
    const res = await api(`/api/calls/calls/${call.id}/clips/${id}`, { method: 'DELETE' });
    if (!res.ok) return setError(err(res.data.error));
    onChange(call.clips.filter((c) => c.id !== id));
  };
  const copy = async (c: ClipDto) => {
    const url = `${window.location.origin}${window.location.pathname}?clip=${c.id}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(c.id);
    window.setTimeout(() => setCopied(null), 2000);
  };
  return (
    <div className="cl-stack" data-testid="calls-clips">
      {call.hasVideo && (
        <form onSubmit={submit} className="cl-form">
          <input ref={titleRef} className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('clipTitle')} aria-label={t('clipTitle')} data-testid="calls-clip-title" />
          <div className="cl-row">
            <label className="cl-inline">
              <span>{t('clipFrom')}</span>
              <input className="input cl-clock" value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" />
            </label>
            <label className="cl-inline">
              <span>{t('clipTo')}</span>
              <input className="input cl-clock" value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" />
            </label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()} data-testid="calls-clip-save">
              {t('clipSave')}
            </button>
          </div>
          <p className="ui-help">{t('clipHelp')}</p>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      {call.clips.length === 0 ? (
        <p className="cl-muted">{t('clipsEmpty')}</p>
      ) : (
        <ul className="cl-comments">
          {call.clips.map((c) => (
            <li key={c.id} data-testid="calls-clip">
              <div className="cl-comment-head">
                <button type="button" className="cl-time" onClick={() => onPlay(c)}>
                  {clock(c.startMs)}–{clock(c.endMs)}
                </button>
                <strong className="cl-wrap">{c.title}</strong>
              </div>
              <div className="cl-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPlay(c)}>
                  {t('clipPlay')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(c)}>
                  {copied === c.id ? t('copied') : t('clipCopy')}
                </button>
                {c.canDelete && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(c.id)}>
                    {t('clipDelete')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AskPanel({ call, onSeek }: { call: CallDetail; onSeek: (ms: number) => void }) {
  const t = useTranslations('calls.call');
  const locale = useLocale();
  const err = useErrorText();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Array<{ q: string; a: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (busy || question.length < 2) return;
    setBusy(true);
    setError(null);
    const res = await api<{ answer?: string }>(`/api/calls/calls/${call.id}/ask`, { method: 'POST', json: { question, locale } });
    setBusy(false);
    if (!res.ok) return setError(err(res.data.error));
    setItems([{ q: question, a: res.data.answer ?? '' }, ...items]);
    setQ('');
  };
  if (!call.transcript.length) return <p className="cl-muted">{t('askLater')}</p>;
  return (
    <div className="cl-stack" data-testid="calls-ask">
      <form onSubmit={submit} className="cl-form">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder={t('askPlaceholder')} aria-label={t('askPlaceholder')} data-testid="calls-ask-input" />
        <div className="cl-row">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || q.trim().length < 2} data-testid="calls-ask-submit">
            {busy ? t('asking') : t('ask')}
          </button>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {items.map((x, i) => (
        <div key={i} className="cl-answer" data-testid="calls-answer">
          <p className="cl-question">{x.q}</p>
          <AnswerText text={x.a} onSeek={onSeek} />
        </div>
      ))}
    </div>
  );
}

/** Respuesta con los [m:ss] como links que saltan a ese momento. */
export function AnswerText({ text, onSeek }: { text: string; onSeek?: (ms: number) => void }) {
  const parts = text.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g);
  return (
    <p className="cl-prose">
      {parts.map((p, i) => {
        const m = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/.exec(p);
        if (m && onSeek) {
          const ms = parseClock(m[1]);
          if (ms !== null)
            return (
              <button key={i} type="button" className="cl-time" onClick={() => onSeek(ms)}>
                {m[1]}
              </button>
            );
        }
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

function ShareDialog({ open, call, onClose, onChange }: { open: boolean; call: CallDetail; onClose: () => void; onChange: (token: string | null) => void }) {
  const t = useTranslations('calls.call');
  const locale = useLocale();
  const err = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = call.shareToken && typeof window !== 'undefined' ? `${window.location.origin}/${locale}/call/${call.shareToken}` : '';
  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    const res = await api<{ token?: string }>(`/api/calls/calls/${call.id}/share`, { method: on ? 'POST' : 'DELETE' });
    setBusy(false);
    if (!res.ok) return setError(err(res.data.error));
    onChange(on ? (res.data.token ?? null) : null);
  };
  const internal = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
  return (
    <CallsDialog open={open} title={t('shareTitle')} onClose={onClose}>
      <div className="ui-modal-body cl-form">
        <div className="ui-field">
          <label htmlFor="cl-share-internal">{t('shareInternal')}</label>
          <input id="cl-share-internal" className="input" readOnly value={internal} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <div className="ui-field">
          <label className="ui-check">
            <input type="checkbox" checked={call.shared} disabled={busy} onChange={(e) => void toggle(e.target.checked)} data-testid="calls-share-toggle" />
            {t('sharePublic')}
          </label>
          <p className="ui-help">{t('sharePublicHelp')}</p>
          {call.shared && url && (
            <div className="cl-row">
              <input className="input cl-grow" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t('sharePublic')} data-testid="calls-share-url" />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(url).catch(() => undefined);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? t('copied') : t('copy')}
              </button>
            </div>
          )}
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('done')}
          </button>
        </div>
      </div>
    </CallsDialog>
  );
}
