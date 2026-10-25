'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CopyButton from '@/components/link/CopyButton';
import VideoRecorder from './VideoRecorder';
import { uploadMedia } from './mediaUpload';
import { fmtDuration } from '@/lib/crm-media-schema';
import { parseDbUtc } from '@/lib/utils';

export interface VideoItem {
  id: string;
  title: string;
  token: string;
  contact_id: string | null;
  contact_name: string | null;
  duration_sec: number;
  views: number;
  last_viewed_at: string | null;
  canManage: boolean;
}

/** Videos 1:1: grabar, subir, buscar, copiar el link, renombrar y borrar. */
export default function VideosLibrary({ initial, direct, baseUrl }: { initial: VideoItem[]; direct: boolean; baseUrl: string }) {
  const t = useTranslations('crm.media');
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirm, setConfirm] = useState<VideoItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.title.toLowerCase().includes(needle) || (r.contact_name ?? '').toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  async function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    const duration = await new Promise<number>((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : 0);
      v.onerror = () => resolve(0);
      v.src = URL.createObjectURL(file);
    });
    const res = await uploadMedia<{ id: string }>({
      kind: 'video',
      file,
      filename: file.name,
      direct,
      fields: { title: file.name.replace(/\.[a-z0-9]+$/i, ''), durationSec: Math.round(duration) },
    });
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) {
      setError(t.has(`errors.${res.code}`) ? t(`errors.${res.code}`) : t('errors.generic'));
      return;
    }
    router.push(`/app/crm/videos/${res.row.id}`);
  }

  async function rename() {
    if (!renaming?.title.trim()) return;
    const res = await fetch(`/api/crm/videos/${renaming.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: renaming.title.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      setRows((prev) => prev.map((r) => (r.id === renaming.id ? { ...r, title: renaming.title.trim() } : r)));
      setRenaming(null);
      router.refresh();
    } else setError(t('errors.generic'));
  }

  async function remove(v: VideoItem) {
    setBusy(true);
    const res = await fetch(`/api/crm/videos/${v.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirm(null);
    if (res?.status === 204) {
      setRows((prev) => prev.filter((r) => r.id !== v.id));
      router.refresh();
    } else setError(t('errors.generic'));
  }

  const fmt = (d: string | null) =>
    d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(d)) : '';

  const actions = (
    <div className="media-toolbar-actions">
      <button type="button" className="btn btn-primary" onClick={() => setRecording(true)} data-testid="video-record">
        {t('recordVideo')}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy} aria-busy={busy || undefined}>
        {busy ? t('uploading') : t('uploadVideo')}
      </button>
    </div>
  );

  return (
    <div className="media-lib" data-testid="videos-library">
      <input
        ref={fileRef}
        type="file"
        accept="video/webm,video/mp4,video/quicktime"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="video-file"
        onChange={(e) => void onFile(e.target.files)}
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t('videosEmptyTitle')} body={t('videosEmptyBody')} action={actions} />
      ) : (
        <>
          <div className="media-toolbar">
            <input
              className="input media-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchVideos')}
              aria-label={t('searchVideos')}
            />
            {actions}
          </div>
          {shown.length === 0 ? (
            <p className="ui-help">{t('noMatches')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table crm-stack media-table">
                <caption className="sr-only">{t('videosTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colName')}</th>
                    <th scope="col">{t('contact')}</th>
                    <th scope="col" className="num">
                      {t('colViews')}
                    </th>
                    <th scope="col">{t('colLastView')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v) => (
                    <tr key={v.id}>
                      <td className="crm-stack-main">
                        {renaming?.id === v.id ? (
                          <form
                            className="media-rename"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void rename();
                            }}
                          >
                            <input
                              className="input"
                              autoFocus
                              value={renaming.title}
                              aria-label={t('rename')}
                              onChange={(e) => setRenaming({ id: v.id, title: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                              maxLength={200}
                            />
                            <button type="submit" className="btn btn-secondary btn-sm">
                              {t('save')}
                            </button>
                          </form>
                        ) : (
                          <>
                            <Link href={`/app/crm/videos/${v.id}`} className="cell-link">
                              {v.title}
                            </Link>
                            {v.duration_sec > 0 && <span className="muted media-sub data">{fmtDuration(v.duration_sec)}</span>}
                          </>
                        )}
                      </td>
                      <td data-label={t('contact')}>
                        {v.contact_id ? (
                          <Link href={`/app/crm/contacts/${v.contact_id}`}>{v.contact_name || t('contact')}</Link>
                        ) : (
                          <span className="muted">{t('anyone')}</span>
                        )}
                      </td>
                      <td className="num data" data-label={t('colViews')}>
                        {v.views}
                      </td>
                      <td className="data" data-label={t('colLastView')}>
                        {v.last_viewed_at ? fmt(v.last_viewed_at) : <span className="muted">{t('never')}</span>}
                      </td>
                      <td className="media-actions">
                        <CopyButton text={`${baseUrl}/${locale}/watch/${v.token}`} className="btn btn-ghost btn-sm" />
                        {v.canManage && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming({ id: v.id, title: v.title })}>
                              {t('rename')}
                            </button>
                            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirm(v)}>
                              {t('delete')}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <VideoRecorder
        open={recording}
        direct={direct}
        onClose={() => setRecording(false)}
        onSaved={(id) => {
          setRecording(false);
          router.push(`/app/crm/videos/${id}`);
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t('deleteVideoTitle', { name: confirm.title }) : ''}
        body={t('deleteVideoBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={() => confirm && remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
