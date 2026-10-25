'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatDuration, type VoiceSessionSummary } from '@/lib/voice-types';
import type { LinkableBooking } from '@/lib/voice-integrations';
import { VoiceNav, voiceErrorKey } from './voice-ui';
import { importRecording } from './importRecording';

interface Props {
  initialSessions: VoiceSessionSummary[];
  bookings: LinkableBooking[];
  transcription: boolean;
  ai: boolean;
  blobPrefix: string | null;
}

/** /app/voice: reuniones (lista, búsqueda, preguntas entre reuniones, próximas de Cal). */
export default function MeetingsHome({ initialSessions, bookings, transcription, ai, blobPrefix }: Props) {
  const t = useTranslations('voice.meetings');
  const tErr = useTranslations('voice.errors');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const [sessions, setSessions] = useState(initialSessions);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<VoiceSessionSummary | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; meetings: Array<{ id: string; title: string; startedAt: string }> } | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoCreated = useRef(false);
  const firstSearch = useRef(true);

  // Búsqueda en título, notas y transcripción (debounce).
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      const res = await fetch(`/api/voice/sessions?kind=meeting&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal }).catch(() => null);
      if (ctrl.signal.aborted) return;
      const data = (await res?.json().catch(() => null)) as { sessions?: VoiceSessionSummary[] } | null;
      setSearching(false);
      if (!res?.ok || !data?.sessions) {
        setSearchError(true);
        return;
      }
      setSessions(data.sessions);
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch('/api/voice/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !data?.id) {
      setBusy(null);
      setError(data?.error ?? 'network');
      return null;
    }
    return data.id;
  }

  async function newMeeting(bookingId?: string) {
    const id = await create({ title: '', bookingId }, bookingId ?? 'new');
    if (id) router.push(`/app/voice/meetings/${id}${bookingId ? '' : '?record=1'}`);
  }

  // ?new=1 (⌘K / sidebar): reunión nueva.
  useEffect(() => {
    if (params.get('new') === '1' && !autoCreated.current) {
      autoCreated.current = true;
      void newMeeting();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const id = await create({ title: file.name.replace(/\.[^.]+$/, '').slice(0, 200), capture: 'file' }, 'import');
    if (!id) return;
    const res = await importRecording({ sessionId: id, file, blobPrefix });
    if (!res.ok) setError(res.error);
    router.push(`/app/voice/meetings/${id}`);
  }

  async function saveRename() {
    if (!renaming) return;
    const { id, title } = renaming;
    const prev = sessions;
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title } : s)));
    setRenaming(null);
    const res = await fetch(`/api/voice/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => null);
    if (!res?.ok) {
      setSessions(prev);
      setError('generic');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const id = deleting.id;
    setBusy(`del:${id}`);
    const res = await fetch(`/api/voice/sessions/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    setDeleting(null);
    if (!res?.ok) {
      setError('generic');
      return;
    }
    setSessions((list) => list.filter((s) => s.id !== id));
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setAskError(null);
    const res = await fetch('/api/voice/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { answer?: string; meetings?: Array<{ id: string; title: string; startedAt: string }>; error?: string } | null;
    setAsking(false);
    if (!res?.ok || !data) {
      setAskError(data?.error ?? 'network');
      return;
    }
    setAnswer({ answer: data.answer ?? '', meetings: data.meetings ?? [] });
  }

  const now = Date.now();
  const upcoming = bookings
    .filter((b) => Date.parse(b.endsAt) >= now - 3_600_000 && Date.parse(b.startsAt) <= now + 3 * 86_400_000)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 4);

  const newButton = (
    <button
      type="button"
      className="btn btn-primary"
      disabled={busy !== null}
      aria-busy={busy === 'new' || undefined}
      onClick={() => void newMeeting()}
    >
      {busy === 'new' ? t('creating') : t('new')}
    </button>
  );

  return (
    <div className="app-page ui-page vc-page">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <button type="button" className="btn btn-ghost" disabled={busy !== null} aria-busy={busy === 'import' || undefined} onClick={() => fileRef.current?.click()}>
              {busy === 'import' ? t('importing') : t('import')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/webm,video/mp4"
              className="sr-only"
              tabIndex={-1}
              aria-label={t('import')}
              data-testid="voice-import-input"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {(sessions.length > 0 || q) && newButton}
          </>
        }
      />
      <VoiceNav />

      {!transcription && (
        <p className="vc-notice" role="note">
          {t('noTranscription')}
        </p>
      )}
      {transcription && !ai && (
        <p className="vc-notice" role="note">
          {t('noAi')}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}

      {upcoming.length > 0 && (
        <section className="vc-block" aria-labelledby="vc-upcoming">
          <h2 id="vc-upcoming" className="ui-section-title">
            {t('upcoming')}
          </h2>
          <ul className="vc-upcoming">
            {upcoming.map((b) => (
              <li key={b.id}>
                <span className="vc-upcoming-text">
                  <strong>{b.title}</strong>
                  <span className="vc-muted">
                    {b.inviteeName} · {format.dateTime(new Date(b.startsAt), { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void newMeeting(b.id)}>
                  {t('takeNotes')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="vc-block" aria-labelledby="vc-ask">
        <h2 id="vc-ask" className="ui-section-title">
          {t('askTitle')}
        </h2>
        <form className="vc-ask" onSubmit={ask}>
          <input
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('askPlaceholder')}
            aria-label={t('askTitle')}
            maxLength={2000}
            data-voice-context="other"
          />
          <button type="submit" className="btn btn-secondary" disabled={!question.trim() || asking} aria-busy={asking || undefined}>
            {asking ? t('asking') : t('ask')}
          </button>
        </form>
        {askError && (
          <p className="ui-error" role="alert">
            {tErr(voiceErrorKey(askError))}
          </p>
        )}
        {answer && (
          <div className="vc-answer" role="status">
            <p>{answer.answer || t('askNothing')}</p>
            {answer.meetings.length > 0 && (
              <p className="vc-muted">
                {t('askSources')}{' '}
                {answer.meetings.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ', '}
                    <Link href={`/app/voice/meetings/${m.id}`}>{m.title || t('untitled')}</Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="vc-block" aria-labelledby="vc-list">
        <div className="vc-block-head">
          <h2 id="vc-list" className="ui-section-title">
            {t('listTitle')}
          </h2>
          <input
            type="search"
            className="input vc-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
          />
        </div>
        {searching && (
          <p className="vc-muted" role="status">
            {t('searching')}
          </p>
        )}
        {searchError && (
          <p className="ui-error" role="alert">
            {t('searchError')}
          </p>
        )}
        {sessions.length === 0 ? (
          q ? (
            <EmptyState compact body={t('noResults', { q })} />
          ) : (
            <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={newButton} secondary={<button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>{t('emptyImport')}</button>} />
          )
        ) : (
          <ul className="vc-list" aria-label={t('listTitle')}>
            {sessions.map((s) => (
              <li key={s.id} className="vc-row" data-testid="voice-meeting-row">
                {renaming?.id === s.id ? (
                  <input
                    className="input vc-rename"
                    value={renaming.title}
                    autoFocus
                    aria-label={t('rename')}
                    maxLength={200}
                    onChange={(e) => setRenaming({ id: s.id, title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => void saveRename()}
                  />
                ) : (
                  <Link href={`/app/voice/meetings/${s.id}`} className="vc-row-main">
                    <span className="vc-row-title">{s.title || t('untitled')}</span>
                    <span className="vc-muted vc-row-meta" suppressHydrationWarning>
                      {format.dateTime(new Date(s.startedAt), { dateStyle: 'medium', timeStyle: 'short' })}
                      {s.durationMs > 0 && ` · ${formatDuration(s.durationMs)}`}
                      {s.status === 'recording' && ` · ${t('statusRecording')}`}
                      {s.status === 'processing' && ` · ${t('statusProcessing')}`}
                    </span>
                    {s.match && <span className="vc-row-match">{s.match}</span>}
                  </Link>
                )}
                <span className="vc-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming({ id: s.id, title: s.title })}>
                    {t('rename')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(s)}>
                    {t('delete')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!deleting}
        title={t('deleteTitle')}
        body={t('deleteBody', { title: deleting?.title || t('untitled') })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy?.startsWith('del:')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
