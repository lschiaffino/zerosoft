'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatDuration, type VoiceCalendarEvent, type VoiceFolder, type VoiceSessionSummary } from '@/lib/voice-types';
import type { SharedWithMe } from '@/lib/voice-share';
import { voiceErrorKey } from './voice-ui';
import { checkRecordingFile, importRecording } from './importRecording';
import RecipeInput from './RecipeInput';
import { BriefModal } from './MeetingPrep';

interface Props {
  initialSessions: VoiceSessionSummary[];
  events: VoiceCalendarEvent[];
  calendarsConnected: boolean;
  folders: VoiceFolder[];
  initialFolder: string | null;
  initialView: 'all' | 'shared';
  initialShared: SharedWithMe[];
  transcription: boolean;
  ai: boolean;
  blobPrefix: string | null;
  blobAccess: 'public' | 'private';
  importMaxBytes: number;
}

type Answer = { answer: string; meetings: Array<{ id: string; title: string; startedAt: string }> };

/**
 * /app/voice: reuniones (como Granola). Próximas del calendario (Cal, Google
 * y Outlook) con brief previo, carpetas propias con un nivel de
 * subcarpetas, lo que compartieron con la persona, búsqueda, preguntas y
 * recipes entre reuniones.
 */
export default function MeetingsHome(props: Props) {
  const { transcription, ai, blobPrefix, blobAccess, importMaxBytes } = props;
  const t = useTranslations('voice.meetings');
  const tErr = useTranslations('voice.errors');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const [sessions, setSessions] = useState(props.initialSessions);
  const [folders, setFolders] = useState(props.folders);
  const [folder, setFolder] = useState<string | null>(props.initialFolder);
  const [view, setView] = useState<'all' | 'shared'>(props.initialView);
  const [shared, setShared] = useState(props.initialShared);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<VoiceSessionSummary | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [folderEdit, setFolderEdit] = useState<{ id: string | null; parentId: string | null; name: string } | null>(null);
  const [folderDelete, setFolderDelete] = useState<VoiceFolder | null>(null);
  const [briefFor, setBriefFor] = useState<VoiceCalendarEvent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoCreated = useRef(false);
  /** Vista, carpeta y búsqueda de lo que hay en la lista ahora (no se vuelve a pedir). */
  const loadedKey = useRef(`${props.initialView}:${props.initialFolder ?? ''}:`);

  // Navegar a otra carpeta desde afuera (⌘K, un link): el servidor manda la lista nueva.
  const lastProps = useRef(`${props.initialView}:${props.initialFolder ?? ''}`);
  useEffect(() => {
    const k = `${props.initialView}:${props.initialFolder ?? ''}`;
    if (k === lastProps.current) return;
    lastProps.current = k;
    loadedKey.current = `${k}:`;
    setFolder(props.initialFolder);
    setView(props.initialView);
    setSessions(props.initialSessions);
    setShared(props.initialShared);
    setFolders(props.folders);
    setQ('');
  }, [props.initialFolder, props.initialView, props.initialSessions, props.initialShared, props.folders]);

  // Lista según carpeta o vista y búsqueda (debounce).
  useEffect(() => {
    const key = `${view}:${folder ?? ''}:${q.trim()}`;
    if (key === loadedKey.current) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      const url =
        view === 'shared'
          ? `/api/voice/shared?q=${encodeURIComponent(q.trim())}`
          : `/api/voice/sessions?kind=meeting&q=${encodeURIComponent(q.trim())}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`;
      const res = await fetch(url, { signal: ctrl.signal }).catch(() => null);
      if (ctrl.signal.aborted) return;
      const data = (await res?.json().catch(() => null)) as { sessions?: VoiceSessionSummary[]; meetings?: SharedWithMe[] } | null;
      setSearching(false);
      if (!res?.ok || !data) {
        setSearchError(true);
        return;
      }
      if (view === 'shared') setShared(data.meetings ?? []);
      else setSessions(data.sessions ?? []);
      loadedKey.current = key;
    }, q ? 250 : 0);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, folder, view]);

  function pick(next: { folder?: string | null; view?: 'all' | 'shared' }) {
    const f = next.view === 'shared' ? null : (next.folder ?? null);
    const v = next.view ?? 'all';
    setFolder(f);
    setView(v);
    setAnswer(null);
    lastProps.current = `${v}:${f ?? ''}`;
    const qs = v === 'shared' ? '?view=shared' : f ? `?folder=${encodeURIComponent(f)}` : '';
    // Solo la URL (para recargar o compartir la vista): la lista ya la trae el efecto de arriba.
    window.history.replaceState(null, '', `/${locale}/app/voice${qs}`);
  }

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch('/api/voice/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, ...(folder ? { folderId: folder } : {}) }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !data?.id) {
      setBusy(null);
      setError(data?.error ?? 'network');
      return null;
    }
    return data.id;
  }

  async function newMeeting(opts: { eventKey?: string; replace?: boolean; query?: string } = {}) {
    const id = await create({ title: '', eventKey: opts.eventKey, locale }, opts.eventKey ?? 'new');
    if (!id) return;
    // Con ?new=1 la URL se reemplaza: "Atrás" desde la reunión no vuelve a crear otra.
    if (opts.replace) router.replace(`/app/voice/meetings/${id}${opts.query ?? ''}`);
    else router.push(`/app/voice/meetings/${id}`);
  }

  // ?new=1 (⌘K / sidebar): reunión nueva; ?event=<clave> (aviso previo): notas para ese evento.
  useEffect(() => {
    if (autoCreated.current) return;
    const ev = params.get('event');
    if (params.get('new') === '1' || ev) {
      autoCreated.current = true;
      const existing = ev ? props.events.find((e) => e.key === ev)?.sessionId : null;
      // ?autostart=desktop ("Tomar notas" de la app de escritorio) pasa a la reunión, que empieza a grabar.
      const query = params.get('autostart') === 'desktop' ? '?autostart=desktop' : '';
      if (existing) router.replace(`/app/voice/meetings/${existing}${query}`);
      else void newMeeting({ replace: true, eventKey: ev ?? undefined, query });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    const invalid = checkRecordingFile(file, importMaxBytes);
    if (invalid) {
      setError(invalid);
      return;
    }
    const id = await create({ title: file.name.replace(/\.[^.]+$/, '').slice(0, 200), capture: 'file', locale }, 'import');
    if (!id) return;
    const res = await importRecording({ sessionId: id, file, blobPrefix, blobAccess });
    if (!res.ok) {
      await fetch(`/api/voice/sessions/${id}`, { method: 'DELETE' }).catch(() => null);
      setBusy(null);
      setError(res.error);
      return;
    }
    router.push(`/app/voice/meetings/${id}`);
  }

  async function patchSession(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/voice/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    return !!res?.ok;
  }

  async function saveRename() {
    if (!renaming) return;
    const { id, title } = renaming;
    const prev = sessions;
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title } : s)));
    setRenaming(null);
    if (!(await patchSession(id, { title }))) {
      setSessions(prev);
      setError('generic');
    }
  }

  async function moveTo(s: VoiceSessionSummary, folderId: string | null) {
    const prev = sessions;
    const prevFolders = folders;
    setSessions((list) => (folder && folderId !== folder && !folders.some((f) => f.id === folderId && f.parentId === folder) ? list.filter((x) => x.id !== s.id) : list.map((x) => (x.id === s.id ? { ...x, folderId } : x))));
    setFolders((list) => list.map((f) => ({ ...f, count: f.count + (f.id === folderId ? 1 : 0) - (f.id === s.folderId ? 1 : 0) })));
    if (!(await patchSession(s.id, { folderId }))) {
      setSessions(prev);
      setFolders(prevFolders);
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

  async function saveFolder() {
    if (!folderEdit) return;
    const name = folderEdit.name.trim();
    if (!name) return setFolderEdit(null);
    setError(null);
    if (folderEdit.id) {
      const id = folderEdit.id;
      const prev = folders;
      setFolders((list) => list.map((f) => (f.id === id ? { ...f, name } : f)));
      setFolderEdit(null);
      const res = await fetch(`/api/voice/folders/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
      if (!res?.ok) {
        setFolders(prev);
        setError('generic');
      }
      return;
    }
    setBusy('folder');
    const res = await fetch('/api/voice/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, parentId: folderEdit.parentId }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (VoiceFolder & { error?: string }) | null;
    setBusy(null);
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? 'network');
      return;
    }
    setFolderEdit(null);
    setFolders((list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)));
    pick({ folder: data.id });
  }

  async function removeFolder() {
    if (!folderDelete) return;
    const id = folderDelete.id;
    setBusy('folder-del');
    const res = await fetch(`/api/voice/folders/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    setFolderDelete(null);
    if (!res?.ok) {
      setError('generic');
      return;
    }
    setFolders((list) => list.filter((f) => f.id !== id && f.parentId !== id));
    if (folder === id || folders.some((f) => f.id === folder && f.parentId === id)) pick({ folder: null });
  }

  async function ask(body: Record<string, unknown>) {
    if (asking) return;
    setAsking(true);
    setAskError(null);
    const res = await fetch('/api/voice/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (Answer & { error?: string }) | null;
    setAsking(false);
    if (!res?.ok || !data) {
      setAskError(data?.error ?? 'network');
      return;
    }
    setAnswer({ answer: data.answer ?? '', meetings: data.meetings ?? [] });
  }

  const now = Date.now();
  const upcoming = props.events.filter((e) => Date.parse(e.endsAt) >= now && Date.parse(e.startsAt) <= now + 3 * 86_400_000).slice(0, 6);
  const top = folders.filter((f) => !f.parentId);
  const current = folders.find((f) => f.id === folder) ?? null;
  const currentParent = current?.parentId ? folders.find((f) => f.id === current.parentId) : null;
  const listTitle = view === 'shared' ? t('sharedWithMe') : current ? current.name : t('listTitle');

  const newButton = (
    <button type="button" className="btn btn-primary" disabled={busy !== null} aria-busy={busy === 'new' || undefined} onClick={() => void newMeeting()}>
      {busy === 'new' ? t('creating') : t('new')}
    </button>
  );

  const folderItem = (f: VoiceFolder, depth: number) => (
    <li key={f.id} className={`vc-folder${depth ? ' is-sub' : ''}`}>
      {folderEdit?.id === f.id ? (
        <input
          className="input vc-folder-input"
          value={folderEdit.name}
          autoFocus
          maxLength={100}
          aria-label={t('folderName')}
          onChange={(e) => setFolderEdit({ ...folderEdit, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveFolder();
            if (e.key === 'Escape') setFolderEdit(null);
          }}
          onBlur={() => void saveFolder()}
        />
      ) : (
        <button type="button" className="vc-folder-btn" aria-current={view === 'all' && folder === f.id ? 'page' : undefined} onClick={() => pick({ folder: f.id })}>
          <span className="vc-folder-name">{f.name}</span>
          <span className="vc-muted num">{f.count}</span>
        </button>
      )}
    </li>
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
            {(sessions.length > 0 || q || folder) && newButton}
          </>
        }
      />

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

      <section className="vc-block" aria-labelledby="vc-upcoming">
        <h2 id="vc-upcoming" className="ui-section-title">
          {t('upcoming')}
        </h2>
        {upcoming.length === 0 ? (
          <p className="vc-muted">
            {t('upcomingEmpty')}
            {!props.calendarsConnected && (
              <>
                {' '}
                <Link href="/app/calendar/settings">{t('connectCalendar')}</Link>
              </>
            )}
          </p>
        ) : (
          <ul className="vc-upcoming" data-testid="voice-upcoming">
            {upcoming.map((e) => (
              <li key={e.key}>
                <span className="vc-upcoming-text">
                  <strong>{e.title || t('untitled')}</strong>
                  <span className="vc-muted" suppressHydrationWarning>
                    {format.dateTime(new Date(e.startsAt), { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {t(`provider.${e.provider}`)}
                    {e.attendees.length > 0 && ` · ${e.attendees.map((a) => a.name || a.email).slice(0, 2).join(', ')}${e.attendees.length > 2 ? ` +${e.attendees.length - 2}` : ''}`}
                  </span>
                </span>
                <span className="vc-upcoming-actions">
                  {e.attendees.length > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBriefFor(e)}>
                      {t('prep')}
                    </button>
                  )}
                  {e.sessionId ? (
                    <Link className="btn btn-secondary btn-sm" href={`/app/voice/meetings/${e.sessionId}`}>
                      {t('openNotes')}
                    </Link>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} aria-busy={busy === e.key || undefined} onClick={() => void newMeeting({ eventKey: e.key })}>
                      {t('takeNotes')}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="vc-block" aria-labelledby="vc-ask">
        <h2 id="vc-ask" className="ui-section-title">
          {t('askTitle')}
        </h2>
        <RecipeInput
          value={question}
          onChange={setQuestion}
          onAsk={(qq) => void ask({ question: qq })}
          onRecipe={(r, topic) => void ask({ recipeId: r.id, question: topic })}
          placeholder={t('askPlaceholder')}
          label={t('askTitle')}
          busy={asking}
          submitLabel={asking ? t('asking') : t('ask')}
        />
        <p className="vc-muted vc-hint">{t('recipesHint')}</p>
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

      <div className="vc-library">
        <nav className="vc-folders" aria-label={t('foldersLabel')}>
          <ul>
            <li className="vc-folder">
              <button type="button" className="vc-folder-btn" aria-current={view === 'all' && !folder ? 'page' : undefined} onClick={() => pick({ folder: null })}>
                <span className="vc-folder-name">{t('allMeetings')}</span>
              </button>
            </li>
            <li className="vc-folder">
              <button type="button" className="vc-folder-btn" aria-current={view === 'shared' ? 'page' : undefined} onClick={() => pick({ view: 'shared' })}>
                <span className="vc-folder-name">{t('sharedWithMe')}</span>
              </button>
            </li>
          </ul>
          <h3 className="vc-folders-title">{t('folders')}</h3>
          <ul>
            {top.map((f) => [folderItem(f, 0), ...folders.filter((s) => s.parentId === f.id).map((s) => folderItem(s, 1))])}
            {folderEdit && !folderEdit.id && (
              <li className={`vc-folder${folderEdit.parentId ? ' is-sub' : ''}`}>
                <input
                  className="input vc-folder-input"
                  value={folderEdit.name}
                  autoFocus
                  maxLength={100}
                  placeholder={t('folderName')}
                  aria-label={t('folderName')}
                  onChange={(e) => setFolderEdit({ ...folderEdit, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveFolder();
                    if (e.key === 'Escape') setFolderEdit(null);
                  }}
                  onBlur={() => void saveFolder()}
                />
              </li>
            )}
          </ul>
          {top.length === 0 && !folderEdit && <p className="vc-muted vc-folders-empty">{t('foldersEmpty')}</p>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy === 'folder'} onClick={() => setFolderEdit({ id: null, parentId: null, name: '' })}>
            {t('newFolder')}
          </button>
        </nav>

        <section className="vc-block vc-library-main" aria-labelledby="vc-list">
          <div className="vc-block-head">
            <h2 id="vc-list" className="ui-section-title">
              {currentParent && <span className="vc-muted">{currentParent.name} / </span>}
              {listTitle}
            </h2>
            <input
              type="search"
              className="input vc-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={view === 'shared' ? t('searchShared') : t('searchPlaceholder')}
              aria-label={view === 'shared' ? t('searchShared') : t('searchPlaceholder')}
            />
          </div>
          {current && (
            <div className="vc-send-row vc-folder-actions">
              {!current.parentId && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderEdit({ id: null, parentId: current.id, name: '' })}>
                  {t('newSubfolder')}
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderEdit({ id: current.id, parentId: current.parentId, name: current.name })}>
                {t('renameFolder')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderDelete(current)}>
                {t('deleteFolder')}
              </button>
            </div>
          )}
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
          {view === 'shared' ? (
            shared.length === 0 ? (
              <EmptyState compact body={q ? t('noResults', { q }) : t('sharedEmpty')} />
            ) : (
              <ul className="vc-list" aria-label={t('sharedWithMe')}>
                {shared.map((m) => (
                  <li key={m.token} className="vc-row" data-testid="voice-shared-row">
                    <a href={`/${locale}/m/${m.token}`} className="vc-row-main">
                      <span className="vc-row-title">{m.title || t('untitled')}</span>
                      <span className="vc-muted vc-row-meta" suppressHydrationWarning>
                        {t('sharedBy', { name: m.ownerName })} · {format.dateTime(new Date(m.startedAt), { dateStyle: 'medium', timeStyle: 'short' })}
                        {m.durationMs > 0 && ` · ${formatDuration(m.durationMs)}`}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )
          ) : sessions.length === 0 ? (
            q ? (
              <EmptyState compact body={t('noResults', { q })} />
            ) : folder ? (
              <EmptyState compact body={t('folderEmpty')} action={newButton} />
            ) : (
              <EmptyState
                title={t('emptyTitle')}
                body={t('emptyBody')}
                action={newButton}
                secondary={
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                    {t('emptyImport')}
                  </button>
                }
              />
            )
          ) : (
            <ul className="vc-list" aria-label={listTitle}>
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
                        {s.shared && ` · ${t('sharedBadge')}`}
                        {!folder && s.folderId && folders.find((f) => f.id === s.folderId) && ` · ${folders.find((f) => f.id === s.folderId)!.name}`}
                      </span>
                      {s.match && <span className="vc-row-match">{s.match}</span>}
                    </Link>
                  )}
                  <span className="vc-row-actions">
                    {folders.length > 0 && (
                      <select
                        className="select select-sm vc-move"
                        value={s.folderId ?? ''}
                        aria-label={t('moveTo', { title: s.title || t('untitled') })}
                        onChange={(e) => void moveTo(s, e.target.value || null)}
                      >
                        <option value="">{t('noFolder')}</option>
                        {top.map((f) => [
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>,
                          ...folders
                            .filter((x) => x.parentId === f.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {`${f.name} / ${x.name}`}
                              </option>
                            )),
                        ])}
                      </select>
                    )}
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
      </div>

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
      <ConfirmDialog
        open={!!folderDelete}
        title={t('deleteFolderTitle')}
        body={t('deleteFolderBody', { name: folderDelete?.name ?? '' })}
        confirmLabel={t('deleteFolder')}
        cancelLabel={t('cancel')}
        danger
        busy={busy === 'folder-del'}
        onConfirm={() => void removeFolder()}
        onCancel={() => setFolderDelete(null)}
      />
      {briefFor && <BriefModal event={briefFor} onClose={() => setBriefFor(null)} />}
    </div>
  );
}
