'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useMounted } from '@/components/ui/useMounted';
import type { RecordingDto } from '@/lib/analytics/replay';
import type { LiveEvent } from '@/lib/analytics/types';
import { api, fmtDuration, fmtTime } from '../client';
import { sanitizeForPlayer } from '@/lib/analytics/replay-sanitize';

interface ReplayerInstance {
  wrapper: HTMLElement;
  iframe: HTMLIFrameElement;
  play(offset?: number): void;
  pause(offset?: number): void;
  getCurrentTime(): number;
  getMetaData(): { startTime: number; endTime: number; totalTime: number };
  setConfig(c: { speed?: number; skipInactive?: boolean }): void;
  on(event: string, cb: (payload: never) => void): void;
  destroy(): void;
}
declare global {
  interface Window {
    rrwebReplay?: { Replayer: new (events: unknown[], config: Record<string, unknown>) => ReplayerInstance };
  }
}

const SPEEDS = [1, 2, 4, 8];
const SEEK_MS = 5000;
let scriptPromise: Promise<void> | null = null;

/** El reproductor se baja solo en esta página. */
function loadReplayer(): Promise<void> {
  if (window.rrwebReplay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/zs-replayer.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error('replayer_load_failed'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

async function inflate(b64: string): Promise<unknown[]> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const parsed = JSON.parse(await new Response(stream).text());
  return Array.isArray(parsed) ? parsed : [];
}

type MarkerKind = 'pageview' | 'click' | 'exception' | 'other';

function markerKind(e: LiveEvent): MarkerKind {
  if (e.event === '$pageview') return 'pageview';
  if (e.event === '$exception') return 'exception';
  if (e.event === '$autocapture' && e.properties.$event_type === 'click') return 'click';
  return 'other';
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Reproductor de una grabación. rrweb arma la página adentro de un iframe con
 * sandbox="allow-same-origin", sin allow-scripts: lo que venga en la grabación
 * (un <script>, un onerror) no corre. Nunca se pasa UNSAFE_replayCanvas, que es
 * lo único que le agrega allow-scripts.
 */
export default function Player({ recording, events, canDelete }: { recording: RecordingDto; events: LiveEvent[]; canDelete: boolean }) {
  const t = useTranslations('analyticsReplay.player');
  const tl = useTranslations('analyticsReplay.recordings');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const mounted = useMounted();
  const router = useRouter();
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const replayer = useRef<ReplayerInstance | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [loaded, setLoaded] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [total, setTotal] = useState(Math.max(1, recording.durationMs));
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [skipInactive, setSkipInactive] = useState(true);
  const [skipping, setSkipping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const deletingRef = useRef(false);
  deletingRef.current = deleting;

  const marks = useMemo(
    () =>
      events.map((e) => ({
        event: e,
        at: Math.max(0, e.ts - recording.startTs),
        kind: markerKind(e),
      })),
    [events, recording.startTs],
  );

  const fit = useCallback(() => {
    const r = replayer.current;
    const s = stage.current;
    if (!r || !s || !size.current.width) return;
    const scale = Math.min(s.clientWidth / size.current.width, s.clientHeight / size.current.height, 1);
    r.wrapper.style.transform = `scale(${scale})`;
    r.wrapper.style.left = `${Math.max(0, (s.clientWidth - size.current.width * scale) / 2)}px`;
    r.wrapper.style.top = `${Math.max(0, (s.clientHeight - size.current.height * scale) / 2)}px`;
  }, []);

  useEffect(() => {
    let gone = false;
    let raf = 0;
    (async () => {
      try {
        await loadReplayer();
        const all: Array<{ type?: number; timestamp?: number }> = [];
        let after = -1;
        let pages = 0;
        for (;;) {
          const page = await api<{ chunks: Array<{ seq: number; data: string }>; next: number | null }>(`/api/analytics/replay/${recording.id}/chunks?after=${after}`);
          for (const c of page.chunks) {
            all.push(...((await inflate(c.data)) as typeof all));
            pages++;
          }
          if (gone) return;
          setLoaded(pages);
          if (page.next === null) break;
          after = page.next;
        }
        if (gone) return;
        if (!all.some((e) => e.type === 2) || !window.rrwebReplay || !root.current) {
          setStatus('empty');
          return;
        }
        all.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        const r = new window.rrwebReplay.Replayer(sanitizeForPlayer(all), {
          root: root.current,
          skipInactive: true,
          speed: 1,
          showWarning: false,
          showDebug: false,
          mouseTail: false,
          triggerFocus: false,
          pauseAnimation: true,
        });
        replayer.current = r;
        r.on('resize', ((d: { width: number; height: number }) => {
          size.current = { width: d.width, height: d.height };
          fit();
        }) as never);
        r.on('finish', (() => setPlaying(false)) as never);
        r.on('skip-start', (() => setSkipping(true)) as never);
        r.on('skip-end', (() => setSkipping(false)) as never);
        setTotal(Math.max(1, r.getMetaData().totalTime));
        setStatus('ready');
        r.play(0);
        setPlaying(true);
        let lastPaint = 0;
        const tick = (now: number) => {
          if (gone) return;
          if (now - lastPaint > 120) {
            lastPaint = now;
            setCurrent(r.getCurrentTime());
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!gone) setStatus('error');
      }
    })();
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      try {
        replayer.current?.destroy();
      } catch {
        // Ya estaba desmontado.
      }
      replayer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording.id]);

  useEffect(() => {
    const s = stage.current;
    if (!s || typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(() => fit());
    o.observe(s);
    return () => o.disconnect();
  }, [fit]);

  const seek = useCallback(
    (ms: number, resume = playing) => {
      const r = replayer.current;
      if (!r) return;
      const to = Math.min(total, Math.max(0, ms));
      setCurrent(to);
      if (resume) {
        r.play(to);
        setPlaying(true);
      } else r.pause(to);
    },
    [playing, total],
  );

  const toggle = useCallback(() => {
    const r = replayer.current;
    if (!r) return;
    if (playing) {
      r.pause();
      setPlaying(false);
    } else {
      r.play(r.getCurrentTime() >= total - 50 ? 0 : r.getCurrentTime());
      setPlaying(true);
    }
  }, [playing, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (deletingRef.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable || (tag === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox');
      if (typing) return;
      if (e.key === 'Escape') {
        router.push('/app/analytics/replay');
      } else if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seek((replayer.current?.getCurrentTime() ?? current) + (e.key === 'ArrowLeft' ? -SEEK_MS : SEEK_MS));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, current, router]);

  useEffect(() => {
    replayer.current?.setConfig({ speed, skipInactive });
  }, [speed, skipInactive]);

  // El evento actual: el último cuyo momento ya pasó. La lista lo sigue sin mover la página.
  const activeIndex = useMemo(() => {
    let found = -1;
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].at <= current) found = i;
      else break;
    }
    return found;
  }, [marks, current]);

  useEffect(() => {
    const ol = list.current;
    if (!ol || activeIndex < 0) return;
    const li = ol.children[activeIndex] as HTMLElement | undefined;
    if (li) ol.scrollTop = Math.max(0, li.offsetTop - ol.offsetTop - ol.clientHeight / 2);
  }, [activeIndex]);

  const title = mounted ? fmtTime(recording.startTs, locale) : ' ';

  return (
    <div className="app-page ui-page an-page">
      <header className="an-replay-head">
        <div className="an-replay-headtext">
          <Link href="/app/analytics/replay" className="an-link an-small">
            {tl('title')}
          </Link>
          <h1 className="an-replay-title">
            {recording.personId ? (
              <Link href={`/app/analytics/persons/${recording.personId}`} className="an-row-link">
                {recording.person}
              </Link>
            ) : (
              recording.person
            )}
          </h1>
          <p className="an-muted an-small">
            {title} · {fmtDuration(recording.durationMs)} · {t('active', { seconds: recording.activeSeconds })} · {tl('clicksCount', { n: recording.clicks })}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={!canDelete} title={canDelete ? undefined : tl('deleteAdminsOnly')} onClick={() => setDeleting(true)}>
          {tc('delete')}
        </button>
      </header>
      {deleteError && (
        <p className="ui-error" role="alert">
          {tc('error')}
        </p>
      )}
      <div className="an-replay-grid">
        <div className="an-replay-main">
          <div className="an-replay-stage" ref={stage} data-testid="an-replay-stage">
            <div className="an-replay-root" ref={root} />
            {status === 'loading' && (
              <p className="an-replay-overlay" role="status">
                {t('loading', { done: loaded, total: recording.chunks })}
              </p>
            )}
            {status === 'error' && (
              <p className="an-replay-overlay ui-error" role="alert">
                {t('error')}
              </p>
            )}
            {status === 'empty' && (
              <p className="an-replay-overlay" role="status">
                {t('unplayable')}
              </p>
            )}
            {skipping && (
              <p className="an-replay-skipping" role="status">
                {t('skipping')}
              </p>
            )}
          </div>
          <div className="an-replay-controls">
            <div className="an-replay-track">
              <div className="an-replay-marks" aria-hidden="true">
                {marks
                  .filter((m) => m.kind !== 'other')
                  .map((m) => (
                    <span key={m.event.id} className={`an-replay-mark an-replay-mark-${m.kind}`} style={{ left: `${Math.min(100, (m.at / total) * 100)}%` }} title={m.event.event} />
                  ))}
              </div>
              <input
                type="range"
                className="an-replay-range"
                min={0}
                max={total}
                step={100}
                value={Math.min(total, current)}
                disabled={status !== 'ready'}
                aria-label={t('timeline')}
                aria-valuetext={`${clock(current)} / ${clock(total)}`}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </div>
            <div className="an-replay-buttons">
              <button type="button" className="btn btn-sm btn-primary an-replay-play" disabled={status !== 'ready'} onClick={toggle} data-testid="an-replay-play">
                {playing ? t('pause') : t('play')}
              </button>
              <span className="an-mono an-nowrap" data-testid="an-replay-time">
                {clock(current)} / {clock(total)}
              </span>
              <label className="an-replay-field">
                <span className="an-small an-muted">{t('speed')}</span>
                <select className="select an-range" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}x
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-check an-small">
                <input type="checkbox" checked={skipInactive} onChange={(e) => setSkipInactive(e.target.checked)} /> {t('skipInactive')}
              </label>
              <span className="an-small an-muted an-replay-keys">{t('keys')}</span>
            </div>
          </div>
        </div>
        <aside className="an-panel an-replay-side" aria-labelledby="an-replay-events-h">
          <h2 id="an-replay-events-h" className="an-h3">
            {t('events')}
          </h2>
          {marks.length === 0 ? (
            <p className="an-muted an-small">{t('noEvents')}</p>
          ) : (
            <ol className="an-replay-events" ref={list} role="list" data-testid="an-replay-events">
              {marks.map((m, i) => (
                <li key={m.event.id}>
                  <button type="button" className="an-replay-event" aria-current={i === activeIndex ? 'true' : undefined} onClick={() => seek(m.at)}>
                    <span className={`an-replay-dot an-replay-mark-${m.kind}`} aria-hidden="true" />
                    <span className="an-replay-eventname">
                      {m.event.event}
                      {m.event.pathname && <span className="an-muted an-small"> {m.event.pathname}</span>}
                    </span>
                    <span className="an-mono an-muted an-small">{clock(m.at)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {recording.pages.length > 1 && (
            <>
              <h3 className="an-h4">{t('pages')}</h3>
              <ul className="an-ids" role="list">
                {recording.pages.map((p) => (
                  <li key={p} className="an-mono">
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <ConfirmDialog
        open={deleting}
        title={tl('deleteTitle')}
        body={tl('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/replay/${recording.id}`, { method: 'DELETE' });
            router.replace('/app/analytics/replay');
            router.refresh();
          } catch {
            setDeleteError(true);
            setBusy(false);
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
