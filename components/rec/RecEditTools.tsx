'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { RecListItem, RecVideoDto } from '@/lib/rec';
import { fillerSegments, fmtClock, keepRanges, MAX_REC_EDIT_BYTES, silenceCuts, type Range, type RecEditPiece, type RecSegment } from '@/lib/rec-schema';
import { composeWebm } from '@/lib/rec-webm';
import { fetchInParts } from './download';
import { uploadAsset, uploadWhole } from './liveUpload';
import { assetsFromVideo } from './recorder-media';
import { notifyRecChanged } from './RecDialogs';

const isWebm = (t: string) => t.startsWith('video/webm');

async function readVideo(id: string, onProgress: (p: number) => void): Promise<Uint8Array> {
  const { blob } = await fetchInParts(`/api/rec/videos/${id}/file?kind=video`, onProgress);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Editar sin recodificar, siempre en una copia nueva (el original queda igual):
 * sacar frases marcando la transcripción, sacar silencios y muletillas, y unir
 * con otra grabación. Se arma en el navegador y se sube directo al
 * almacenamiento, como una grabación: ninguna función lee el video entero.
 */
export default function RecEditTools({ video, uploadMode, partBytes }: { video: RecVideoDto; uploadMode: 'blob' | 'local'; partBytes: number }) {
  const t = useTranslations('rec.edit');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [silences, setSilences] = useState<Range[]>([]);
  const [others, setOthers] = useState<RecListItem[] | null>(null);
  const [joinId, setJoinId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const segs: RecSegment[] = video.transcript;
  const end = video.trimEnd ?? video.durationSec;
  const webm = isWebm(video.contentType);
  const tooBig = video.size > MAX_REC_EDIT_BYTES;

  const cuts = useMemo<Range[]>(() => [...silences, ...[...picked].map((i) => [segs[i].start, segs[i].end] as Range)], [silences, picked, segs]);
  const keep = useMemo(() => keepRanges(cuts, video.trimStart, end), [cuts, video.trimStart, end]);
  const kept = keep.reduce((n, [a, b]) => n + b - a, 0);
  const removed = Math.max(0, end - video.trimStart - kept);

  useEffect(() => {
    let alive = true;
    void fetch('/api/rec/videos?scope=all')
      .then((r) => (r.ok ? (r.json() as Promise<{ videos: RecListItem[] }>) : null))
      .then((d) => {
        if (alive) setOthers((d?.videos ?? []).filter((x) => x.id !== video.id && x.canManage));
      })
      .catch(() => alive && setOthers([]));
    return () => {
      alive = false;
    };
  }, [video.id]);

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const message = (code: string) => (tc.has(`errors.${code}`) ? tc(`errors.${code}`) : t('failed'));

  /** Crea la copia: sube el archivo, arma miniatura y GIF, y la cierra copiando la transcripción. */
  async function createCopy(title: string, sources: Array<{ id: string; keep: Range[] }>, sourceSizes: number[]) {
    setBusy(t('working', { pct: 0 }));
    setError(null);
    let newId: string | null = null;
    try {
      if (sourceSizes.some((n) => n > MAX_REC_EDIT_BYTES)) throw new Error('edit_too_large');
      const loaded: Array<{ bytes: Uint8Array; keep: Array<[number, number]> }> = [];
      for (let i = 0; i < sources.length; i++) {
        const bytes = await readVideo(sources[i].id, (p) => setBusy(t('working', { pct: Math.round((i * 50 + p / 2) / sources.length) })));
        loaded.push({ bytes, keep: sources[i].keep.map(([a, b]) => [a * 1000, b * 1000]) });
      }
      const out = composeWebm(loaded);
      if (!out.ok) throw new Error(out.error === 'incompatible' ? 'join_incompatible' : out.error === 'nothing_left' ? 'edit_nothing_left' : 'cut_failed');
      const res = await fetch('/api/rec/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, mode: video.mode, contentType: 'video/webm', space: 'personal', titleSource: 'user' }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'upload_failed');
      const data = (await res.json()) as { video: { id: string } };
      newId = data.video.id;
      const blob = new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: 'video/webm' });
      await uploadWhole(newId, 'video', blob, uploadMode, partBytes, {}, (p) => setBusy(t('working', { pct: 50 + Math.round(p / 2) })));
      setBusy(t('finishing'));
      try {
        const assets = await assetsFromVideo(`/api/rec/videos/${newId}/file?kind=video`, 0, null);
        if (assets.thumb) await uploadAsset(newId, 'thumb', assets.thumb, { forTrim: '0:', atSec: assets.thumbAt });
        if (assets.gif) await uploadAsset(newId, 'gif', assets.gif, { forTrim: '0:' });
      } catch {
        // Sin miniatura se muestra el vacío: el video igual sirve.
      }
      const pieces: RecEditPiece[] = out.pieces.map((p) => ({ src: p.src, from: p.fromMs / 1000, to: p.toMs / 1000, at: p.atMs / 1000 }));
      const fin = await fetch(`/api/rec/videos/${newId}/derive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationSec: Math.round(out.durationMs / 100) / 10, width: video.width, height: video.height, sources: sources.map((s) => s.id), pieces }),
      });
      if (!fin.ok) throw new Error('upload_failed');
      notifyRecChanged();
      router.push(`/${locale}/app/rec/${newId}`);
    } catch (err) {
      if (newId) await fetch(`/api/rec/videos/${newId}`, { method: 'DELETE' }).catch(() => undefined);
      setError(message(err instanceof Error ? err.message : 'cut_failed'));
      setBusy(null);
    }
  }

  const joinable = (others ?? []).filter((o) => o.status === 'ready' && isWebm(o.contentType));
  const joinTarget = joinable.find((o) => o.id === joinId);

  if (!webm) {
    return (
      <section className="rec-edit-block" data-testid="rec-edit-tools">
        <h2 className="rec-h">{t('title')}</h2>
        <p className="ui-help" data-testid="rec-edit-only-webm">
          {t('onlyWebm')}
        </p>
      </section>
    );
  }

  return (
    <section className="rec-edit-block" data-testid="rec-edit-tools">
      <h2 className="rec-h">{t('title')}</h2>
      <p className="ui-help">{t('help')}</p>
      {tooBig && <p className="ui-error">{tc('errors.edit_too_large')}</p>}
      {segs.length === 0 ? (
        <p className="ui-help">{t('noTranscript')}</p>
      ) : (
        <>
          <div className="rec-pane-foot rec-edit-marks">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSilences(silenceCuts(segs, video.durationSec))} data-testid="rec-mark-silences">
              {t('markSilences')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPicked((p) => new Set([...p, ...fillerSegments(segs)]))} data-testid="rec-mark-fillers">
              {t('markFillers')}
            </button>
            {(picked.size > 0 || silences.length > 0) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setPicked(new Set());
                  setSilences([]);
                }}
              >
                {t('clearMarks')}
              </button>
            )}
          </div>
          <ul className="rec-edit-segs" aria-label={t('segments')}>
            {segs.map((s, i) => (
              <li key={i}>
                <label className={`ui-check rec-edit-seg${picked.has(i) ? ' cut' : ''}`}>
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} data-testid="rec-edit-seg" />
                  <span className="data">{fmtClock(s.start)}</span>
                  <span className="rec-edit-seg-text">{s.text}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="ui-help" role="status" data-testid="rec-edit-summary">
            {t('summary', { removed: fmtClock(removed), kept: fmtClock(kept) })}
          </p>
          <p className="ui-help">{t('precision')}</p>
          <div className="rec-pane-foot">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!!busy || tooBig || cuts.length === 0 || keep.length === 0}
              onClick={() => void createCopy(t('editedTitle', { title: video.title }).slice(0, 200), [{ id: video.id, keep }], [video.size])}
              data-testid="rec-edit-create"
            >
              {t('createEdited')}
            </button>
          </div>
        </>
      )}
      <h3 className="rec-h">{t('joinTitle')}</h3>
      <p className="ui-help">{t('joinHelp')}</p>
      {others === null ? (
        <div className="ui-skeleton-text" aria-busy="true" />
      ) : joinable.length === 0 ? (
        <p className="ui-help">{t('joinEmpty')}</p>
      ) : (
        <div className="ui-field">
          <label className="label" htmlFor="rec-join">
            {t('joinWith')}
          </label>
          <select id="rec-join" className="input" value={joinId} onChange={(e) => setJoinId(e.target.value)} data-testid="rec-join-select">
            <option value="">{t('joinPick')}</option>
            {joinable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} ({fmtClock(o.durationSec)})
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="rec-pane-foot">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!!busy || !joinTarget || tooBig}
          onClick={() =>
            joinTarget &&
            void createCopy(
              t('joinedTitle', { a: video.title, b: joinTarget.title }).slice(0, 200),
              [
                { id: video.id, keep: [[video.trimStart, end]] },
                { id: joinTarget.id, keep: [[joinTarget.trimStart, joinTarget.trimEnd ?? joinTarget.durationSec + 1]] },
              ],
              [video.size, joinTarget.size],
            )
          }
          data-testid="rec-join-create"
        >
          {t('joinCreate')}
        </button>
      </div>
      {busy && (
        <p className="ui-help" role="status" data-testid="rec-edit-busy">
          {busy}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert" data-testid="rec-edit-error">
          {error}
        </p>
      )}
    </section>
  );
}
