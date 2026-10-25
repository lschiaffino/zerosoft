'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CopyButton from '@/components/link/CopyButton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import ContactPicker, { type PickedContact } from './ContactPicker';
import { fmtDuration, watchedPct } from '@/lib/crm-media-schema';
import { parseDbUtc } from '@/lib/utils';

interface ViewRow {
  id: string;
  started_at: string;
  watched_sec: number;
  max_position: number;
  duration_sec: number;
}

/** Un video 1:1: link para compartir, datos (título, contacto, mensaje) y reproducciones. */
export default function VideoDetail({
  video,
  views,
  shareUrl,
  canManage,
}: {
  video: { id: string; title: string; url: string; contentType: string; message: string; contact: PickedContact | null; durationSec: number };
  views: ViewRow[];
  shareUrl: string;
  canManage: boolean;
}) {
  const t = useTranslations('crm.media');
  const locale = useLocale();
  const router = useRouter();
  const [title, setTitle] = useState(video.title);
  const [message, setMessage] = useState(video.message);
  const [contact, setContact] = useState<PickedContact | null>(video.contact);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);

  const fmt = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(d));

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/crm/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), message, contactId: contact?.id ?? null }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setNote({ tone: 'ok', text: t('saved') });
      router.refresh();
    } else setNote({ tone: 'error', text: t('errors.generic') });
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/crm/videos/${video.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.status === 204) router.push('/app/crm/videos');
    else setNote({ tone: 'error', text: t('errors.generic') });
  }

  return (
    <div className="media-detail video-detail" data-testid="video-detail">
      <div className="video-detail-grid">
        <div className="video-detail-player">
          <video className="vw-video" controls playsInline preload="metadata" aria-label={video.title}>
            <source src={video.url} type={video.contentType.split(';')[0]} />
          </video>
          <div className="media-link-url">
            <code className="data" data-testid="video-share-url">
              {shareUrl}
            </code>
            <CopyButton text={shareUrl} className="btn btn-secondary btn-sm" />
            <a className="btn btn-ghost btn-sm" href={shareUrl} target="_blank" rel="noreferrer">
              {t('openPage')}
            </a>
          </div>
          <p className="ui-help">{t('shareVideoHelp')}</p>
        </div>
        <form
          className="video-detail-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="ui-field">
            <label className="label" htmlFor="vd-title">
              {t('videoTitle')}
            </label>
            <input id="vd-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} maxLength={200} />
          </div>
          {canManage ? (
            <ContactPicker value={contact} onChange={setContact} label={t('forContact')} />
          ) : (
            contact && (
              <p>
                <Link href={`/app/crm/contacts/${contact.id}`}>{contact.name}</Link>
              </p>
            )
          )}
          <div className="ui-field">
            <label className="label" htmlFor="vd-msg">
              {t('message')}
            </label>
            <textarea
              id="vd-msg"
              className="textarea"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={!canManage}
              maxLength={2000}
            />
          </div>
          {note && (
            <p className={note.tone === 'error' ? 'ui-error' : 'ui-help'} role={note.tone === 'error' ? 'alert' : 'status'}>
              {note.text}
            </p>
          )}
          {canManage && (
            <div className="media-detail-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()} aria-busy={busy || undefined}>
                {t('save')}
              </button>
              <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirm(true)}>
                {t('delete')}
              </button>
            </div>
          )}
        </form>
      </div>

      <section className="media-section">
        <h2 className="crm-panel-title">{t('playsTitle')}</h2>
        {views.length === 0 ? (
          <EmptyState quiet title={t('playsEmptyTitle')} body={t('playsEmptyBody')} />
        ) : (
          <ul className="media-links" data-testid="video-views">
            {views.map((v) => (
              <li key={v.id} className="media-link">
                <div className="media-link-head">
                  <span className="data">{fmt(v.started_at)}</span>
                  <span className="data muted">{t('watched', { time: fmtDuration(v.watched_sec) })}</span>
                  {(v.duration_sec || video.durationSec) > 0 && (
                    <span className="data muted">{t('watchedPct', { pct: watchedPct(v.max_position, v.duration_sec || video.durationSec) })}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        title={t('deleteVideoTitle', { name: video.title })}
        body={t('deleteVideoBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
