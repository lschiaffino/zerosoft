'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  formatDuration,
  VOICE_BUILTIN_TEMPLATES,
  type VoiceFolder,
  type VoiceSegment,
  type VoiceSessionDetail,
  type VoiceShareInfo,
  type VoiceTemplate,
} from '@/lib/voice-types';
import { LevelBars, MicIcon, voiceErrorKey } from './voice-ui';
import { useRecorder, type CaptureMode } from './RecorderProvider';
import { recordingSupported, tabAudioSupported } from './audio';
import EnhancedNotes from './EnhancedNotes';
import { ChatPanel, DetailsPanel, TranscriptPanel } from './MeetingSide';
import { copyText } from './insert';
import { checkRecordingFile, importRecording } from './importRecording';
import { BriefPanel, FollowupModal, SendModal, ShareModal } from './MeetingPrep';
import { AUTOSTART_NONCE_RE, desktopBridge } from '@/lib/desktop-bridge';

type Detail = VoiceSessionDetail & { contact: { id: string; name: string; email: string } | null; share: VoiceShareInfo | null };

interface Props {
  initial: Detail;
  templates: VoiceTemplate[];
  folders: VoiceFolder[];
  transcription: boolean;
  ai: boolean;
  blobPrefix: string | null;
  blobAccess: 'public' | 'private';
  importMaxBytes: number;
}

/**
 * Una reunión (como una nota de Granola): grabás, escribís tus notas
 * mientras tanto y al terminar la IA las completa con la transcripción.
 * A la derecha, la transcripción en vivo, el chat sobre la reunión y los
 * vínculos (Cal, CRM, Docs, Notes).
 */
export default function MeetingView({ initial, templates, folders, transcription, ai, blobPrefix, blobAccess, importMaxBytes }: Props) {
  const t = useTranslations('voice.meeting');
  const tTpl = useTranslations('voice.templates.builtin');
  const tErr = useTranslations('voice.errors');
  const tExport = useTranslations('voice.export');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [d, setD] = useState<Detail>(initial);
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.myNotes);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [mode, setMode] = useState<CaptureMode>('mic');
  const [tab, setTab] = useState<'transcript' | 'chat' | 'details'>('transcript');
  const [view, setView] = useState<'enhanced' | 'mine'>(initial.enhanced ? 'enhanced' : 'mine');
  const [enhancing, setEnhancing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [docsDialog, setDocsDialog] = useState(false);
  const [docsTranscript, setDocsTranscript] = useState(false);
  // Sin teamspace privado posible, el diálogo pasa a avisar que la ve todo el workspace.
  const [docsWorkspace, setDocsWorkspace] = useState(false);
  const [modal, setModal] = useState<'share' | 'followup' | 'send' | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lo que soporta el navegador se mira después de hidratar (en el servidor no hay MediaRecorder).
  const [support, setSupport] = useState({ rec: true, tab: true });
  // App de escritorio: "pestaña" es el audio del sistema (sin selector), y va por defecto.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const bridge = desktopBridge();
    setSupport({ rec: recordingSupported(), tab: tabAudioSupported() || !!bridge?.systemAudio });
    if (bridge?.systemAudio) {
      setDesktop(true);
      setMode('mic_tab');
    }
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/voice/sessions/${d.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      return res?.ok ? ((await res.json()) as Detail) : null;
    },
    [d.id],
  );

  const onSegments = useCallback((segs: VoiceSegment[]) => {
    setD((prev) => {
      const ids = new Set(prev.segments.map((s) => s.id));
      const merged = [...prev.segments, ...segs.filter((s) => !ids.has(s.id))].sort((a, b) => a.startMs - b.startMs || a.source.localeCompare(b.source));
      const last = merged.reduce((m, s) => Math.max(m, s.endMs), prev.durationMs);
      return { ...prev, segments: merged, durationMs: last };
    });
  }, []);

  // El grabador vive en el layout de la app: sigue grabando si se navega a otra página.
  const recorder = useRecorder();
  const active = recorder.sessionId === d.id;
  const recordingElsewhere = !!recorder.sessionId && !active && recorder.state !== 'idle';
  // Otra pestaña u otro dispositivo tomó la grabación de esta reunión (claim con latido en el servidor).
  // Se decide con el estado fresco del servidor: al recargar una pestaña que grababa, el cierre
  // (sendBeacon) puede llegar después del render y la reunión ya no está grabando.
  const [serverChecked, setServerChecked] = useState(initial.status !== 'recording');
  const otherRecorder = serverChecked && !active && d.status === 'recording' && d.recorderLive && d.recorderId !== recorder.recorderId;
  const failedParts = recorder.failed[d.id] ?? 0;
  const recoveredParts = recorder.recovered[d.id] ?? 0;
  const rec = {
    state: active ? recorder.state : ('idle' as const),
    error: active ? recorder.error : null,
    pending: active ? recorder.pending : 0,
    lagging: active && recorder.lagging,
    elapsed: active ? recorder.elapsed : 0,
    level: active ? recorder.level : 0,
    tabLive: active && recorder.tabLive,
  };

  // Nota con IA en cola en el servidor (al cortar la grabación o al importar): se espera a que esté.
  const [notesStatus, setNotesStatus] = useState(initial.notesStatus);
  const refresh = useCallback(async () => {
    const fresh = await fetch(`/api/voice/sessions/${d.id}`)
      .then((r) => (r.ok ? (r.json() as Promise<Detail>) : null))
      .catch(() => null);
    if (!fresh) return null;
    setNotesStatus(fresh.notesStatus);
    setD((prev) => ({
      ...prev,
      status: fresh.status,
      recorderId: fresh.recorderId,
      recorderLive: fresh.recorderLive,
      durationMs: Math.max(prev.durationMs, fresh.durationMs),
      enhanced: fresh.enhanced,
      enhancedAt: fresh.enhancedAt,
      crmActivityId: fresh.crmActivityId,
      segments: fresh.segments.length >= prev.segments.length ? fresh.segments : prev.segments,
    }));
    if (fresh.enhanced && fresh.notesStatus === 'done') setView('enhanced');
    return fresh;
  }, [d.id]);

  useEffect(
    () =>
      recorder.subscribe(d.id, onSegments, () => {
        setNotesStatus('queued');
        void refresh();
      }),
    [recorder, d.id, onSegments, refresh],
  );

  useEffect(() => {
    if (notesStatus !== 'queued' && notesStatus !== 'running') return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const fresh = await refresh();
      if (!fresh || (fresh.notesStatus !== 'queued' && fresh.notesStatus !== 'running') || tries > 90) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [notesStatus, refresh]);

  useEffect(() => {
    if (serverChecked) return;
    const timer = setTimeout(() => void refresh().finally(() => setServerChecked(true)), 1500);
    return () => clearTimeout(timer);
  }, [serverChecked, refresh]);

  // Mientras graba otra pestaña o dispositivo, esta se refresca sola (cada 15 s): muestra la
  // transcripción que llega y se habilita para grabar cuando la otra deja de latir.
  useEffect(() => {
    if (!otherRecorder) return;
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [otherRecorder, refresh]);

  async function flushNotes() {
    if (notesTimer.current) {
      clearTimeout(notesTimer.current);
      notesTimer.current = null;
      await patch({ myNotes: notes });
    }
  }

  async function stopRecording() {
    // Lo último que se escribió entra en la nota que se arma al cortar.
    await flushNotes();
    await recorder.stop();
  }

  const enhance = useCallback(
    async (templateKey?: string) => {
      setEnhancing(true);
      setError(null);
      // Las notas sin guardar van antes de mejorar.
      if (notesTimer.current) {
        clearTimeout(notesTimer.current);
        notesTimer.current = null;
        await patch({ myNotes: notes });
      }
      const res = await fetch(`/api/voice/sessions/${d.id}/enhance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale, templateKey }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { enhanced?: Detail['enhanced']; enhancedAt?: string; crmActivityId?: string | null; error?: string } | null;
      setEnhancing(false);
      if (!res?.ok || !data?.enhanced) {
        setError(data?.error ?? (res ? 'generic' : 'network'));
        return;
      }
      setD((prev) => ({ ...prev, enhanced: data.enhanced ?? null, enhancedAt: data.enhancedAt ?? null, crmActivityId: data.crmActivityId ?? prev.crmActivityId, templateKey: templateKey ?? prev.templateKey }));
      setView('enhanced');
    },
    [d.id, locale, notes, patch],
  );

  function onNotesChange(v: string) {
    setNotes(v);
    setSaveState('saving');
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      notesTimer.current = null;
      const ok = await patch({ myNotes: v });
      setSaveState(ok ? 'saved' : 'error');
    }, 700);
  }

  async function saveTitle() {
    const next = title.trim();
    if (next === d.title) return;
    const res = await patch({ title: next });
    if (res) setD((prev) => ({ ...prev, title: res.title }));
    else setError('generic');
  }

  async function renameSpeaker(key: string, name: string) {
    const speakers = { ...d.speakers };
    if (name) speakers[key] = name;
    else delete speakers[key];
    setD((prev) => ({ ...prev, speakers }));
    if (!(await patch({ speakers }))) setError('generic');
  }

  async function send(target: 'docs' | 'notes' | 'markdown', opts: { includeTranscript?: boolean; allowWorkspace?: boolean } = {}) {
    setBusy(target);
    setError(null);
    setFlash(null);
    setDocsDialog(false);
    const res = await fetch(`/api/voice/sessions/${d.id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, locale, includeTranscript: opts.includeTranscript, allowWorkspace: opts.allowWorkspace }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; markdown?: string; error?: string } | null;
    setBusy(null);
    if (target === 'docs' && data?.error === 'docs_private_unavailable') {
      setDocsWorkspace(true);
      setDocsDialog(true);
      return;
    }
    if (!res?.ok || !data) {
      setError(data?.error ?? (res ? 'generic' : 'network'));
      return;
    }
    if (target === 'markdown') {
      setFlash((await copyText(data.markdown ?? '')) ? t('copied') : t('copyFailed'));
      return;
    }
    if (target === 'docs') setD((prev) => ({ ...prev, docsPageId: data.id ?? null }));
    if (target === 'notes') setD((prev) => ({ ...prev, noteId: data.id ?? null }));
    setFlash(target === 'docs' ? t('sentDocs') : t('sentNotes'));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy('import');
    setError(null);
    const invalid = checkRecordingFile(file, importMaxBytes);
    if (invalid) {
      setBusy(null);
      setError(invalid);
      return;
    }
    const res = await importRecording({ sessionId: d.id, file, blobPrefix, blobAccess });
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // La nota con IA se arma sola en el servidor; se espera a que esté.
    setNotesStatus('queued');
    await refresh();
  }

  async function remove() {
    setBusy('delete');
    const res = await fetch(`/api/voice/sessions/${d.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setConfirmDelete(false);
      setError('generic');
      return;
    }
    router.push('/app/voice');
  }

  async function moveTo(folderId: string | null) {
    const prev = d.folderId;
    setD((p) => ({ ...p, folderId }));
    if (!(await patch({ folderId }))) {
      setD((p) => ({ ...p, folderId: prev }));
      setError('generic');
    }
  }

  const recording = rec.state === 'recording' || rec.state === 'stopping';
  const canRecord = transcription && support.rec;

  // "Tomar notas" desde la app de escritorio (?autostart=<nonce>): empieza a grabar sola una vez,
  // solo si la app confirma que el nonce lo creó ella recién (un link copiado no graba nada).
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostarted.current || !serverChecked || !canRecord) return;
    const nonce = new URLSearchParams(window.location.search).get('autostart');
    if (!nonce) return;
    autostarted.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    const bridge = desktopBridge();
    if (!bridge?.consumeAutostart || !AUTOSTART_NONCE_RE.test(nonce)) return;
    if (rec.state !== 'idle' || recordingElsewhere || otherRecorder) return;
    void bridge.consumeAutostart(nonce).then((ok) => {
      if (!ok) return;
      void recorder.start({ sessionId: d.id, mode: bridge.systemAudio ? 'mic_tab' : 'mic', baseOffsetMs: d.durationMs, desktop: true });
    });
  }, [serverChecked, canRecord, rec.state, recordingElsewhere, otherRecorder, recorder, d.id, d.durationMs]);
  const recError = rec.error;
  const hasContent = d.segments.length > 0 || notes.trim().length > 0;
  const hasNotes = !!d.enhanced || notes.trim().length > 0;
  const topFolders = folders.filter((f) => !f.parentId);

  return (
    <div className="app-page ui-page vc-page vc-meeting">
      <div className="vc-meeting-top">
        <Link href="/app/voice" className="ui-page-back">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {t('back')}
        </Link>
      </div>
      <header className="vc-meeting-head">
        <input
          className="vc-title-input"
          value={title}
          placeholder={t('untitled')}
          aria-label={t('titleLabel')}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(d.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <p className="vc-muted" suppressHydrationWarning>
          {format.dateTime(new Date(d.startedAt), { dateStyle: 'full', timeStyle: 'short' })}
          {(rec.state === 'recording' ? rec.elapsed : d.durationMs) > 0 && ` · ${formatDuration(rec.state === 'recording' ? rec.elapsed : d.durationMs)}`}
          {d.contact && ` · ${d.contact.name}`}
          {d.share && ` · ${t('sharedBadge')}`}
        </p>
        <div className="vc-head-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => setModal('share')}>
            {t('share')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !hasNotes} onClick={() => setModal('followup')}>
            {t('followup')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !hasNotes} onClick={() => setModal('send')}>
            {t('sendSlackNotion')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !hasContent} onClick={() => void send('markdown')}>
            {t('copyMarkdown')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !hasContent} aria-busy={busy === 'docs' || undefined} onClick={() => setDocsDialog(true)}>
            {t('sendDocs')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !hasContent} aria-busy={busy === 'notes' || undefined} onClick={() => void send('notes')}>
            {t('sendNotes')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || recording} onClick={() => setConfirmDelete(true)}>
            {t('delete')}
          </button>
          {folders.length > 0 && (
            <select className="select select-sm vc-move" value={d.folderId ?? ''} aria-label={t('folder')} onChange={(e) => void moveTo(e.target.value || null)}>
              <option value="">{t('noFolder')}</option>
              {topFolders.map((f) => [
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
        </div>
      </header>

      {flash && (
        <p className="vc-ok" role="status">
          {flash}{' '}
          {flash === t('sentDocs') && d.docsPageId && <Link href={`/app/docs/${d.docsPageId}`}>{t('open')}</Link>}
          {flash === t('sentNotes') && d.noteId && <Link href={`/app/notes?note=${d.noteId}`}>{t('open')}</Link>}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}

      <section className={`vc-recorder${recording ? ' is-recording' : ''}`} aria-label={t('recorderLabel')}>
        {!transcription ? (
          <p className="vc-notice">{tErr('transcribe_disabled')}</p>
        ) : !support.rec ? (
          <p className="vc-notice">{t('unsupported')}</p>
        ) : null}
        <div className="vc-recorder-row">
          {rec.state === 'idle' || rec.state === 'starting' ? (
            <>
              <fieldset className="vc-mode" disabled={!canRecord || rec.state === 'starting'}>
                <legend className="sr-only">{t('modeLabel')}</legend>
                <label className="ui-check">
                  <input type="radio" name="vc-mode" checked={mode === 'mic'} onChange={() => setMode('mic')} />
                  <span>{t('modeMic')}</span>
                </label>
                {support.tab && (
                  <label className="ui-check">
                    <input type="radio" name="vc-mode" checked={mode === 'mic_tab'} onChange={() => setMode('mic_tab')} />
                    <span>{desktop ? t('modeSystem') : t('modeTab')}</span>
                  </label>
                )}
              </fieldset>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canRecord || rec.state === 'starting' || recordingElsewhere || otherRecorder}
                aria-busy={rec.state === 'starting' || undefined}
                onClick={() => void recorder.start({ sessionId: d.id, mode, baseOffsetMs: d.durationMs, desktop })}
              >
                <MicIcon /> {d.segments.length ? t('resume') : t('start')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !transcription} aria-busy={busy === 'import' || undefined} onClick={() => fileRef.current?.click()}>
                {busy === 'import' ? t('importing') : t('import')}
              </button>
              <input ref={fileRef} type="file" accept="audio/*,video/webm,video/mp4" className="sr-only" tabIndex={-1} aria-label={t('import')} onChange={(e) => void onFile(e.target.files?.[0])} />
            </>
          ) : (
            <>
              <span className="vc-rec-dot" aria-hidden="true" />
              <LevelBars level={rec.level} />
              <span className="vc-rec-time data" role="timer">
                {formatDuration(rec.elapsed)}
              </span>
              <span className="vc-muted" role="status">
                {rec.state === 'stopping'
                  ? t('finishing')
                  : rec.lagging
                    ? t('lagging', { count: rec.pending })
                    : rec.pending > 0
                      ? t('transcribingN', { count: rec.pending })
                      : recorder.mode === 'mic_tab' && !rec.tabLive
                        ? t('tabEnded')
                        : t('recording')}
              </span>
              <button type="button" className="btn btn-primary" disabled={rec.state === 'stopping'} onClick={() => void stopRecording()}>
                {t('stop')}
              </button>
            </>
          )}
        </div>
        {mode === 'mic_tab' && rec.state === 'idle' && <p className="vc-muted">{desktop ? t('systemHelp') : t('tabHelp')}</p>}
        {otherRecorder && (
          <p className="vc-notice" role="status">
            {t('otherRecorder')}
          </p>
        )}
        {recoveredParts > 0 && failedParts === 0 && d.enhanced && rec.state === 'idle' && (
          <p className="vc-notice" role="status">
            {t('recoveredParts', { count: recoveredParts })}{' '}
            <button type="button" className="btn btn-sm btn-secondary" disabled={enhancing} onClick={() => void enhance(d.templateKey)}>
              {t('regenerate')}
            </button>
          </p>
        )}
        {failedParts > 0 && rec.state !== 'recording' && (
          <p className="vc-notice" role="status">
            {t('failedParts', { count: failedParts })}{' '}
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => recorder.retryFailed(d.id)}>
              {t('retryParts')}
            </button>
          </p>
        )}
        {recordingElsewhere && (
          <p className="vc-notice" role="status">
            {t('recordingElsewhere')} <Link href={`/app/voice/meetings/${recorder.sessionId}`}>{t('openOther')}</Link>
          </p>
        )}
        {(notesStatus === 'queued' || notesStatus === 'running') && !recording && (
          <p className="vc-muted" role="status">
            {t('notesQueued')}
          </p>
        )}
        <p className="vc-muted vc-consent">{t('consent')}</p>
        {recError && (
          <p className="ui-error" role="alert">
            {tErr(voiceErrorKey(recError))}
          </p>
        )}
      </section>

      {(d.brief || ((d.attendees.length > 0 || !!d.contactId) && d.segments.length === 0)) && (
        <BriefPanel key={`${d.attendees.length}:${d.contactId ?? ''}`} sessionId={d.id} initial={d.brief} canBrief={d.attendees.length > 0 || !!d.contactId} />
      )}

      <div className="vc-meeting-grid">
        <section className="vc-notes" aria-labelledby="vc-notes-title">
          <div className="vc-notes-head">
            <h2 id="vc-notes-title" className="ui-section-title">
              {view === 'enhanced' && d.enhanced ? t('aiNotes') : t('myNotes')}
            </h2>
            {d.enhanced && (
              <div className="btn-group" role="group" aria-label={t('viewLabel')}>
                <button type="button" className="btn btn-sm" aria-pressed={view === 'enhanced'} onClick={() => setView('enhanced')}>
                  {t('viewAi')}
                </button>
                <button type="button" className="btn btn-sm" aria-pressed={view === 'mine'} onClick={() => setView('mine')}>
                  {t('viewMine')}
                </button>
              </div>
            )}
          </div>
          {view === 'enhanced' && d.enhanced ? (
            <EnhancedNotes sessionId={d.id} enhanced={d.enhanced} hasContact={!!d.contactId} />
          ) : (
            <>
              <textarea
                className="textarea vc-notes-input"
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder={t('notesPlaceholder')}
                aria-label={t('myNotes')}
                data-voice-context="note"
                rows={12}
              />
              <p className="vc-muted vc-save" role="status">
                {saveState === 'saving' ? t('saving') : saveState === 'saved' ? t('saved') : saveState === 'error' ? t('saveError') : ''}
              </p>
            </>
          )}
          <div className="vc-enhance-row">
            <label className="vc-inline-field">
              <span className="label">{t('template')}</span>
              <select
                className="select"
                value={d.templateKey}
                onChange={(e) => {
                  const key = e.target.value;
                  setD((prev) => ({ ...prev, templateKey: key }));
                  void patch({ templateKey: key });
                }}
              >
                {VOICE_BUILTIN_TEMPLATES.map((k) => (
                  <option key={k} value={k}>
                    {tTpl(k)}
                  </option>
                ))}
                {templates.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={enhancing || recording || !hasContent}
              aria-busy={enhancing || undefined}
              onClick={() => void enhance(d.templateKey)}
            >
              {enhancing ? t('enhancing') : d.enhanced ? t('regenerate') : t('enhance')}
            </button>
          </div>
          {!ai && <p className="vc-muted">{tErr('ai_disabled')}</p>}
        </section>

        <aside className="vc-side" aria-label={t('sideLabel')}>
          <div className="ui-tabs" role="tablist" aria-label={t('sideLabel')}>
            {(['transcript', 'chat', 'details'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`vc-tab-${k}`}
                aria-controls={`vc-panel-${k}`}
                aria-selected={tab === k}
                tabIndex={tab === k ? 0 : -1}
                className="ui-tab"
                onClick={() => setTab(k)}
                onKeyDown={(e) => {
                  const order = ['transcript', 'chat', 'details'] as const;
                  const i = order.indexOf(k);
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const next = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
                    setTab(next);
                    document.getElementById(`vc-tab-${next}`)?.focus();
                  }
                }}
              >
                {t(`tabs.${k}`)}
                {k === 'transcript' && d.segments.length > 0 && <span className="vc-count">{d.segments.length}</span>}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`vc-panel-${tab}`} aria-labelledby={`vc-tab-${tab}`} className="vc-panel">
            {tab === 'transcript' && (
              <TranscriptPanel
                segments={d.segments}
                speakers={d.speakers}
                onRenameSpeaker={(k, n) => void renameSpeaker(k, n)}
                recording={recording}
                deletedAt={d.transcriptDeletedAt}
              />
            )}
            {tab === 'chat' && <ChatPanel sessionId={d.id} initial={d.chat} ai={ai} />}
            {tab === 'details' && (
              <DetailsPanel
                sessionId={d.id}
                calBookingId={d.calBookingId}
                contact={d.contact}
                crmActivityId={d.crmActivityId}
                docsPageId={d.docsPageId}
                noteId={d.noteId}
                attendees={d.attendees}
                onAttendees={async (attendees) => {
                  const prev = d.attendees;
                  setD((p) => ({ ...p, attendees }));
                  if (!(await patch({ attendees }))) {
                    setD((p) => ({ ...p, attendees: prev }));
                    setError('generic');
                  }
                }}
                onLinked={(p) => {
                  if (p.title !== undefined) setTitle(p.title);
                  setD((prev) => ({
                    ...prev,
                    ...(p.title !== undefined ? { title: p.title } : {}),
                    ...(p.calBookingId !== undefined ? { calBookingId: p.calBookingId } : {}),
                    ...(p.contact !== undefined ? { contact: p.contact, contactId: p.contact?.id ?? null } : {}),
                    ...(p.crmActivityId !== undefined ? { crmActivityId: p.crmActivityId } : {}),
                  }));
                }}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Docs no tiene espacio privado todavía: la página la ve todo el workspace. */}
      <ConfirmDialog
        open={docsDialog}
        title={t('docsConfirmTitle')}
        body={
          <>
            <span className="vc-confirm-text">{docsWorkspace ? t('docsConfirmBody') : t('docsPrivateBody', { space: tExport('privateSpace') })}</span>
            <label className="ui-check vc-confirm-check">
              <input type="checkbox" checked={docsTranscript} onChange={(e) => setDocsTranscript(e.target.checked)} />
              <span>{t('docsIncludeTranscript')}</span>
            </label>
          </>
        }
        confirmLabel={t('docsConfirm')}
        cancelLabel={t('cancel')}
        busy={busy === 'docs'}
        onConfirm={() => void send('docs', { includeTranscript: docsTranscript, allowWorkspace: docsWorkspace })}
        onCancel={() => setDocsDialog(false)}
      />
      {modal === 'share' && <ShareModal sessionId={d.id} onClose={() => setModal(null)} onChange={(share) => setD((p) => ({ ...p, share }))} />}
      {modal === 'followup' && (
        <FollowupModal
          sessionId={d.id}
          initial={d.followup}
          defaultTo={[...d.attendees.map((a) => a.email), ...(d.contact?.email ? [d.contact.email] : [])].filter(Boolean)}
          onClose={() => setModal(null)}
          onSaved={(followup) => setD((p) => ({ ...p, followup }))}
        />
      )}
      {modal === 'send' && <SendModal sessionId={d.id} onClose={() => setModal(null)} />}
      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteTitle')}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
