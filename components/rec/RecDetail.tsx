'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { RecAnalytics, RecVideoDto } from '@/lib/rec';
import { fmtClock, parseClock, trimmedDuration } from '@/lib/rec-schema';
import { parseDbUtc } from '@/lib/utils';
import RecPlayer, { type RecMarker, type RecPlayerHandle } from './RecPlayer';
import RecComments from './RecComments';
import RecCopy from './RecCopy';
import RecDownload from './RecDownload';
import RecShareDialog from './RecShareDialog';
import { RecTranscript } from './RecWatch';
import { RecMoveDialog, RecNameDialog, notifyRecChanged, type RecFolder } from './RecDialogs';
import { canvasToBlob, snapshot } from './recorder-media';
import { uploadAsset } from './liveUpload';

type Tab = 'details' | 'transcript' | 'insights' | 'edit';

/**
 * Detalle de un video en la app: reproductor, compartir, comentarios,
 * transcripción, resumen y capítulos (IA, editables), analítica y edición
 * (recorte, llamada a la acción y miniatura).
 */
export default function RecDetail({ initial, folders, baseUrl }: { initial: RecVideoDto; folders: RecFolder[]; baseUrl: string }) {
  const t = useTranslations('rec.detail');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const [video, setVideo] = useState(initial);
  const [tab, setTab] = useState<Tab>('details');
  const [markers, setMarkers] = useState<RecMarker[]>([]);
  const [now, setNow] = useState(0);
  const [share, setShare] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState<RecAnalytics | null>(null);
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [chaptersText, setChaptersText] = useState(initial.chaptersText);
  const [trimStart, setTrimStart] = useState(fmtClock(initial.trimStart));
  const [trimEnd, setTrimEnd] = useState(initial.trimEnd === null ? '' : fmtClock(initial.trimEnd));
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel);
  const [ctaUrl, setCtaUrl] = useState(initial.ctaUrl);
  const [ctaMode, setCtaMode] = useState(initial.ctaMode);
  const [thumbVer, setThumbVer] = useState(0);
  const player = useRef<RecPlayerHandle>(null);
  // Avisa al sidebar y vacía la caché del router: volver atrás no muestra la lista vieja.
  const changed = () => {
    notifyRecChanged();
    router.refresh();
  };

  const file = `/api/rec/videos/${video.id}/file`;
  const shareUrl = `${baseUrl}/${locale}/v/${video.shareId}`;
  const back = video.folderId ? `/app/rec/f/${video.folderId}` : video.space === 'workspace' ? '/app/rec/workspace' : '/app/rec';
  const backLabel = video.folderId ? folders.find((f) => f.id === video.folderId)?.name ?? t('library') : video.space === 'workspace' ? t('workspace') : t('mine');

  useEffect(() => {
    const created = search.get('created');
    if (created) setToast(created === 'copied' ? t('createdCopied') : t('created'));
  }, [search, t]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const apply = useCallback((v: RecVideoDto) => {
    setVideo(v);
    setSummary(v.summary);
    setChaptersText(v.chaptersText);
  }, []);

  // Mientras se transcribe, se consulta cada 3 s.
  useEffect(() => {
    if (video.transcriptStatus !== 'pending' && video.transcriptStatus !== 'processing') return;
    const id = window.setInterval(async () => {
      const res = await fetch(`/api/rec/videos/${video.id}`).catch(() => null);
      if (!res?.ok) return;
      const { video: v } = (await res.json()) as { video: RecVideoDto };
      if (v.transcriptStatus !== 'pending' && v.transcriptStatus !== 'processing') {
        apply(v);
        router.refresh();
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [video.id, video.transcriptStatus, apply, router]);

  useEffect(() => {
    if (tab !== 'insights') return;
    void fetch(`/api/rec/videos/${video.id}/analytics`)
      .then((r) => (r.ok ? (r.json() as Promise<RecAnalytics>) : null))
      .then((d) => setStats(d ?? null))
      .catch(() => setStats(null));
  }, [tab, video.id]);

  const fail = async (res: Response | null) => {
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic';
    setError(tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.generic'));
  };

  async function patch(body: Record<string, unknown>, okToast?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/videos/${video.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      await fail(res);
      return false;
    }
    const { video: v } = (await res.json()) as { video: RecVideoDto };
    setVideo(v);
    if (okToast) setToast(okToast);
    changed();
    return true;
  }

  async function retranscribe() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rec/videos/${video.id}/transcribe`, { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    const { video: v } = (await res.json()) as { video: RecVideoDto };
    setVideo(v);
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/rec/videos/${video.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.status !== 204) return fail(res);
    changed();
    router.push(`/${locale}${back}`);
  }

  async function saveTrim() {
    const s = parseClock(trimStart || '0');
    const e = trimEnd.trim() ? parseClock(trimEnd) : null;
    if (s === null || (trimEnd.trim() && e === null)) {
      setError(t('invalidTime'));
      return;
    }
    if (await patch({ trimStart: s, trimEnd: e }, t('saved'))) {
      setTrimStart(fmtClock(s));
    }
  }

  async function takeFrameAsThumb() {
    const v = player.current?.video();
    let blob: Blob | null = null;
    try {
      const shot = v ? snapshot(v, 960) : null;
      blob = shot ? await canvasToBlob(shot, 'image/jpeg', 0.85) : null;
    } catch {
      blob = null;
    }
    if (!blob) return setError(t('frameFailed'));
    setBusy(true);
    try {
      await uploadAsset(video.id, 'thumb', blob);
      setThumbVer((n) => n + 1);
      setToast(t('thumbSaved'));
      changed();
    } catch {
      setError(tc('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  const visible = trimmedDuration(video.durationSec, video.trimStart, video.trimEnd);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(video.createdAt));
  const relNow = () => video.trimStart + (player.current?.current() ?? 0);
  const transcriptMsg = (() => {
    switch (video.transcriptStatus) {
      case 'pending':
      case 'processing':
        return t('transcribing');
      case 'disabled':
        return t('aiOff');
      case 'failed':
        return tc.has(`errors.${video.transcriptError}`) ? tc(`errors.${video.transcriptError}`) : t('transcribeFailed');
      default:
        return null;
    }
  })();

  return (
    <div className="app-page ui-page rec-detail" data-testid="rec-detail">
      <PageHeader
        title={video.title}
        description={`${video.authorName ? `${video.authorName} · ` : ''}${date}`}
        back={{ href: back, label: backLabel }}
        actions={
          <>
            <RecCopy text={shareUrl} label={t('copyLink')} className="btn btn-primary" testId="rec-copy-link" />
            <button type="button" className="btn btn-secondary" onClick={() => setShare(true)} data-testid="rec-share">
              {t('share')}
            </button>
          </>
        }
      />
      <div className="rec-detail-tools">
        <RecDownload url={`${file}?download=1`} label={t('download')} className="btn btn-ghost btn-sm" testId="rec-download" />
        <Link className="btn btn-ghost btn-sm" href={`/v/${video.shareId}`} target="_blank">
          {t('openPage')}
        </Link>
        {video.canManage && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(true)} data-testid="rec-rename">
              {t('rename')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoving(true)}>
              {t('move')}
            </button>
            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setDeleting(true)}>
              {t('delete')}
            </button>
          </>
        )}
        <span className="rec-detail-badges muted">
          {video.privacy === 'workspace' ? t('badgeWorkspace') : t('badgeLink')}
          {video.hasPassword ? ` · ${t('badgePassword')}` : ''}
          {video.expiresAt ? ` · ${t('badgeExpires', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(video.expiresAt)) })}` : ''}
        </span>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="rec-detail-grid">
        <div className="rec-detail-main">
          <RecPlayer
            ref={player}
            src={file}
            captionsSrc={video.transcript.length ? `${file}?kind=captions` : null}
            poster={video.hasThumb ? `${file}?kind=thumb&v=${thumbVer}` : null}
            title={video.title}
            durationSec={video.durationSec}
            trimStart={video.trimStart}
            trimEnd={video.trimEnd}
            chapters={video.chapters}
            markers={markers}
            cta={video.ctaLabel && video.ctaUrl ? { label: video.ctaLabel, url: video.ctaUrl, mode: video.ctaMode } : null}
            onTime={setNow}
          />
          <div className="ui-tabs" role="tablist" aria-label={t('tabs')}>
            {(['details', 'transcript', 'insights', ...(video.canManage ? (['edit'] as const) : [])] as Tab[]).map((k) => (
              <button key={k} type="button" role="tab" className="ui-tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`rec-tab-${k}`}>
                {t(`tab.${k}`)}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <div className="rec-pane" role="tabpanel">
              {transcriptMsg && video.transcriptStatus !== 'done' && (
                <p className={`rec-status ${video.transcriptStatus}`} role="status" data-testid="rec-ai-status">
                  {transcriptMsg}
                </p>
              )}
              <div className="ui-field">
                <label className="label" htmlFor="rec-summary">
                  {t('summary')}
                </label>
                <textarea id="rec-summary" className="textarea" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} readOnly={!video.canManage} maxLength={5000} data-testid="rec-summary" />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="rec-desc">
                  {t('description')}
                </label>
                <textarea id="rec-desc" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} readOnly={!video.canManage} maxLength={5000} />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="rec-chapters">
                  {t('chapters')}
                </label>
                <textarea
                  id="rec-chapters"
                  className="textarea data"
                  rows={4}
                  value={chaptersText}
                  onChange={(e) => setChaptersText(e.target.value)}
                  readOnly={!video.canManage}
                  placeholder={'0:00 Intro\n0:45 Demo'}
                  data-testid="rec-chapters"
                />
                <p className="ui-help">{t('chaptersHelp')}</p>
              </div>
              {video.chapters.length > 0 && (
                <ol className="rec-chapters">
                  {video.chapters.map((c) => (
                    <li key={c.start}>
                      <button type="button" className="rec-chapter" onClick={() => player.current?.seek(c.start - video.trimStart)}>
                        <span className="data">{fmtClock(Math.max(0, c.start - video.trimStart))}</span>
                        <span>{c.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {video.canManage && (
                <div className="rec-pane-foot">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retranscribe()} disabled={busy || video.transcriptStatus === 'processing'}>
                    {t('regenerate')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => void patch({ summary, description, chaptersText }, t('saved'))}
                    data-testid="rec-details-save"
                  >
                    {tc('save')}
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'transcript' && (
            <div className="rec-pane" role="tabpanel">
              {transcriptMsg && (
                <p className={`rec-status ${video.transcriptStatus}`} role="status">
                  {transcriptMsg}
                </p>
              )}
              <RecTranscript
                segments={video.transcript}
                trimStart={video.trimStart}
                trimEnd={video.trimEnd}
                now={now}
                onSeek={(s) => player.current?.seek(s)}
                emptyText={video.transcriptStatus === 'done' ? t('noSpeech') : t('noTranscript')}
              />
              {video.canManage && (video.transcriptStatus === 'failed' || video.transcriptStatus === 'disabled' || video.transcriptStatus === 'done') && (
                <div className="rec-pane-foot">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void retranscribe()} disabled={busy} data-testid="rec-retranscribe">
                    {t('retranscribe')}
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'insights' && (
            <div className="rec-pane" role="tabpanel" data-testid="rec-insights">
              {!stats ? (
                <div className="ui-skeleton-text" aria-busy="true" />
              ) : (
                <>
                  <dl className="rec-stats">
                    <div>
                      <dt>{t('views')}</dt>
                      <dd className="data">{stats.views}</dd>
                    </div>
                    <div>
                      <dt>{t('unique')}</dt>
                      <dd className="data">{stats.unique}</dd>
                    </div>
                    <div>
                      <dt>{t('avgWatched')}</dt>
                      <dd className="data">{stats.avgPct}%</dd>
                    </div>
                    <div>
                      <dt>{t('completed')}</dt>
                      <dd className="data">{stats.completed}</dd>
                    </div>
                    <div>
                      <dt>{t('ctaClicks')}</dt>
                      <dd className="data">{stats.ctaClicks}</dd>
                    </div>
                  </dl>
                  {stats.viewers.length === 0 ? (
                    <p className="ui-help">{t('noViews')}</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table table-compact">
                        <caption className="sr-only">{t('viewers')}</caption>
                        <thead>
                          <tr>
                            <th scope="col">{t('viewer')}</th>
                            <th scope="col" className="num">
                              {t('views')}
                            </th>
                            <th scope="col" className="num">
                              {t('watched')}
                            </th>
                            <th scope="col">{t('lastView')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.viewers.map((r) => (
                            <tr key={r.viewerKey}>
                              <td>
                                {r.name || t('anonymous')}
                                {r.signedIn && <span className="muted"> · {t('signedIn')}</span>}
                              </td>
                              <td className="num data">{r.views}</td>
                              <td className="num data">{r.pct}%</td>
                              <td className="data">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(r.lastAt))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <a className="btn btn-secondary btn-sm" href={`/api/rec/videos/${video.id}/analytics?format=csv`} download>
                    {t('exportCsv')}
                  </a>
                </>
              )}
            </div>
          )}

          {tab === 'edit' && video.canManage && (
            <div className="rec-pane" role="tabpanel">
              <section className="rec-edit-block">
                <h2 className="rec-h">{t('trim')}</h2>
                <p className="ui-help">{t('trimHelp', { length: fmtClock(video.durationSec) })}</p>
                <div className="ui-fields ui-fields-2">
                  <div className="ui-field">
                    <label className="label" htmlFor="rec-ts">
                      {t('trimStart')}
                    </label>
                    <div className="ui-input-group">
                      <input id="rec-ts" className="input data" value={trimStart} onChange={(e) => setTrimStart(e.target.value)} inputMode="numeric" placeholder="0:00" data-testid="rec-trim-start" />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTrimStart(fmtClock(relNow()))}>
                        {t('useCurrent')}
                      </button>
                    </div>
                  </div>
                  <div className="ui-field">
                    <label className="label" htmlFor="rec-te">
                      {t('trimEnd')}
                    </label>
                    <div className="ui-input-group">
                      <input id="rec-te" className="input data" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} inputMode="numeric" placeholder={fmtClock(video.durationSec)} data-testid="rec-trim-end" />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTrimEnd(fmtClock(relNow()))}>
                        {t('useCurrent')}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="ui-help">{t('trimResult', { length: fmtClock(visible) })}</p>
                <div className="rec-pane-foot">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setTrimStart('0:00');
                      setTrimEnd('');
                      void patch({ trimStart: 0, trimEnd: null }, t('saved'));
                    }}
                    disabled={busy}
                  >
                    {t('trimReset')}
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveTrim()} disabled={busy} data-testid="rec-trim-save">
                    {t('trimSave')}
                  </button>
                </div>
              </section>
              <section className="rec-edit-block">
                <h2 className="rec-h">{t('cta')}</h2>
                <p className="ui-help">{t('ctaHelp')}</p>
                <div className="ui-fields ui-fields-2">
                  <div className="ui-field">
                    <label className="label" htmlFor="rec-cta-label">
                      {t('ctaLabel')}
                    </label>
                    <input id="rec-cta-label" className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={60} data-testid="rec-cta-label" />
                  </div>
                  <div className="ui-field">
                    <label className="label" htmlFor="rec-cta-url">
                      {t('ctaUrl')}
                    </label>
                    <input id="rec-cta-url" className="input" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://" inputMode="url" maxLength={2000} data-testid="rec-cta-url" />
                  </div>
                </div>
                <fieldset className="rec-share-group">
                  <legend className="label">{t('ctaWhen')}</legend>
                  <label className="ui-check">
                    <input type="radio" name="rec-cta-mode" checked={ctaMode === 'always'} onChange={() => setCtaMode('always')} />
                    <span>{t('ctaAlways')}</span>
                  </label>
                  <label className="ui-check">
                    <input type="radio" name="rec-cta-mode" checked={ctaMode === 'end'} onChange={() => setCtaMode('end')} />
                    <span>{t('ctaEnd')}</span>
                  </label>
                </fieldset>
                <div className="rec-pane-foot">
                  {(video.ctaLabel || video.ctaUrl) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => {
                        setCtaLabel('');
                        setCtaUrl('');
                        void patch({ ctaLabel: '', ctaUrl: '' }, t('saved'));
                      }}
                    >
                      {t('ctaRemove')}
                    </button>
                  )}
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void patch({ ctaLabel, ctaUrl, ctaMode }, t('saved'))} data-testid="rec-cta-save">
                    {tc('save')}
                  </button>
                </div>
              </section>
              <section className="rec-edit-block">
                <h2 className="rec-h">{t('thumbnail')}</h2>
                <p className="ui-help">{t('thumbnailHelp')}</p>
                <div className="rec-pane-foot">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void takeFrameAsThumb()} disabled={busy}>
                    {t('useFrame')}
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
        <aside className="rec-detail-side">
          <h2 className="rec-h">{t('comments')}</h2>
          <RecComments
            shareId={video.shareId}
            trimStart={video.trimStart}
            allowComments={video.allowComments}
            canModerate={video.canManage}
            currentAbs={relNow}
            onSeek={(s) => player.current?.seek(s)}
            onMarkers={setMarkers}
          />
        </aside>
      </div>
      {toast && (
        <div className="ui-toasts" aria-live="polite">
          <div className="ui-toast" role="status" data-testid="rec-toast">
            {toast}
          </div>
        </div>
      )}
      <RecShareDialog open={share} video={video} shareUrl={shareUrl} onClose={() => setShare(false)} onSave={(p) => patch(p, t('saved'))} />
      <RecNameDialog
        open={renaming}
        title={t('rename')}
        label={t('name')}
        initial={video.title}
        submitLabel={tc('save')}
        busy={busy}
        onSubmit={async (n) => {
          if (await patch({ title: n })) setRenaming(false);
        }}
        onClose={() => setRenaming(false)}
      />
      <RecMoveDialog
        open={moving}
        folders={folders}
        current={{ space: video.space, folderId: video.folderId }}
        busy={busy}
        onMove={async (m) => {
          if (await patch({ folderId: m.folderId, space: m.space }, t('moved'))) setMoving(false);
        }}
        onClose={() => setMoving(false)}
      />
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { title: video.title })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}
