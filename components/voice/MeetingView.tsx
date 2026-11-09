'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import { DetailsPanel, TranscriptPanel } from './MeetingSide';
import MeetingAsk, { type ChatModelOption } from './MeetingAsk';
import MeetingPeople, { type LinkResult } from './MeetingPeople';
import Pop from './Pop';
import VoiceModal from './VoiceModal';
import { copyText } from './insert';
import { checkRecordingFile, importRecording } from './importRecording';
import { BriefPanel, SendModal, ShareModal } from './MeetingPrep';
import { AUTOSTART_NONCE_RE, desktopBridge } from '@/lib/desktop-bridge';
import { seekParam } from '@/lib/voice-cite';
import { takeAutostart } from './autostart';

type Detail = VoiceSessionDetail & { contact: { id: string; name: string; email: string } | null; share: VoiceShareInfo | null };

interface Props {
  initial: Detail;
  templates: VoiceTemplate[];
  folders: VoiceFolder[];
  transcription: boolean;
  ai: boolean;
  /** Hay modelo para el chat (el del asistente ⌘J o el de la suite). */
  chatAi?: boolean;
  blobPrefix: string | null;
  blobAccess: 'public' | 'private';
  importMaxBytes: number;
  /** Gmail u Outlook conectado con permiso de envío (el seguimiento sale de ahí). */
  mailbox?: { email: string; provider: 'gmail' | 'outlook' } | null;
  /** Modelos que se pueden elegir en el chat. */
  chatModels?: ChatModelOption[];
}

/**
 * Una reunión como una nota de Granola: una página limpia con el título, los
 * chips (qué notas ver, el evento y la gente, la carpeta) y las notas. Abajo,
 * la barra con el audio en vivo y "Preguntá lo que quieras", que abre el chat
 * sobre las notas. Al cortar, la IA completa las notas con la transcripción.
 */
export default function MeetingView({
  initial,
  templates,
  folders: initialFolders,
  transcription,
  ai,
  chatAi = ai,
  blobPrefix,
  blobAccess,
  importMaxBytes,
  mailbox = null,
  chatModels = [],
}: Props) {
  const t = useTranslations('voice.meeting');
  const tTpl = useTranslations('voice.templates.builtin');
  const tErr = useTranslations('voice.errors');
  const tExport = useTranslations('voice.export');
  const locale = useLocale();
  const router = useRouter();
  const [d, setD] = useState<Detail>(initial);
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.myNotes);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [mode, setMode] = useState<CaptureMode>('mic');
  // Lo que está abierto sobre la barra de abajo: el chat o la transcripción en vivo.
  const [dock, setDock] = useState<'none' | 'ask' | 'transcript'>('none');
  const [folders, setFolders] = useState(initialFolders);
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
  const [modal, setModal] = useState<'share' | 'send' | 'details' | null>(null);
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
  // El último intento de empezar fue en esta reunión (aunque el micrófono no haya abierto).
  const attempted = recorder.attemptId === d.id;
  const recordingElsewhere = recorder.state !== 'idle' && !!recorder.attemptId && !attempted;
  // Otra pestaña u otro dispositivo tomó la grabación de esta reunión (claim con latido en el servidor).
  // Se decide con el estado fresco del servidor: al recargar una pestaña que grababa, el cierre
  // (sendBeacon) puede llegar después del render y la reunión ya no está grabando.
  const [serverChecked, setServerChecked] = useState(initial.status !== 'recording');
  const otherRecorder = serverChecked && !active && d.status === 'recording' && d.recorderLive && d.recorderId !== recorder.recorderId;
  const failedParts = recorder.failed[d.id] ?? 0;
  const recoveredParts = recorder.recovered[d.id] ?? 0;
  const rec = {
    state: active || (attempted && recorder.state === 'starting') ? recorder.state : ('idle' as const),
    error: attempted ? recorder.error : null,
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
  // Reunión recién creada con un clic (Nueva reunión, Tomar notas, ⌘K): empieza a escuchar sola,
  // como Granola. En la app de escritorio, con el audio del sistema si está disponible.
  const selfStarted = useRef(false);
  useEffect(() => {
    if (selfStarted.current || !serverChecked) return;
    selfStarted.current = true;
    if (!takeAutostart(d.id)) return;
    if (!canRecord || rec.state !== 'idle' || recordingElsewhere || otherRecorder || d.segments.length > 0) return;
    const bridge = desktopBridge();
    void recorder.start({ sessionId: d.id, mode: bridge?.systemAudio ? 'mic_tab' : 'mic', baseOffsetMs: d.durationMs, desktop: !!bridge?.systemAudio });
  }, [serverChecked, canRecord, rec.state, recordingElsewhere, otherRecorder, recorder, d.id, d.durationMs, d.segments.length]);

  // Ir a un momento de la transcripción: una cita del chat o ?t=<segundos> en el link.
  const [focus, setFocus] = useState<{ ms: number; n: number } | null>(null);
  const seek = useCallback((ms: number) => {
    setDock('transcript');
    setFocus({ ms, n: Date.now() });
  }, []);
  useEffect(() => {
    const ms = seekParam(new URLSearchParams(window.location.search).get('t'));
    if (ms !== null) seek(ms);
  }, [seek]);

  const recError = rec.error;
  const hasContent = d.segments.length > 0 || notes.trim().length > 0;
  const hasNotes = !!d.enhanced || notes.trim().length > 0;
  const topFolders = folders.filter((f) => !f.parentId);
  const folder = folders.find((f) => f.id === d.folderId) ?? null;
  const showingEnhanced = view === 'enhanced' && !!d.enhanced;
  const notesBusy = notesStatus === 'queued' || notesStatus === 'running';
  const idle = rec.state === 'idle' || rec.state === 'starting';

  const onDockOpen = useCallback((open: boolean) => setDock((cur) => (open ? 'ask' : cur === 'ask' ? 'none' : cur)), []);

  const onAttendees = useCallback(
    async (attendees: Detail['attendees']) => {
      let prev: Detail['attendees'] = [];
      setD((p) => {
        prev = p.attendees;
        return { ...p, attendees };
      });
      if (!(await patch({ attendees }))) {
        setD((p) => ({ ...p, attendees: prev }));
        setError('generic');
      }
    },
    [patch],
  );

  const onLinked = useCallback((r: LinkResult) => {
    setD((prev) => ({
      ...prev,
      eventKey: r.eventKey,
      ...(r.title ? { title: prev.title.trim() ? prev.title : r.title } : {}),
      ...(r.calBookingId !== undefined ? { calBookingId: r.calBookingId } : {}),
      ...(r.attendees ? { attendees: r.attendees } : {}),
      ...(r.contact !== undefined ? { contact: r.contact, contactId: r.contact?.id ?? null } : {}),
    }));
    // El título del evento solo entra si el campo sigue vacío (no se pisa lo que se está escribiendo).
    if (r.title) setTitle((cur) => (cur.trim() ? cur : r.title!));
  }, []);

  async function createFolder(name: string) {
    const clean = name.trim();
    if (!clean) return;
    const res = await fetch('/api/voice/folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: clean }) }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (VoiceFolder & { error?: string }) | null;
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? 'generic');
      return;
    }
    setFolders((f) => [...f, { ...data, count: data.count ?? 0, parentId: data.parentId ?? null }]);
    await moveTo(data.id);
  }

  async function copyLink() {
    if (!d.share) {
      setModal('share');
      return;
    }
    const url = `${window.location.origin}/${locale}/m/${d.share.token}`;
    setFlash((await copyText(url)) ? t('linkCopied') : t('copyFailed'));
  }

  const start = () => void recorder.start({ sessionId: d.id, mode, baseOffsetMs: d.durationMs, desktop });
  const status =
    rec.state === 'stopping'
      ? t('finishing')
      : rec.lagging
        ? t('lagging', { count: rec.pending })
        : rec.pending > 0
          ? t('transcribingN', { count: rec.pending })
          : recorder.mode === 'mic_tab' && !rec.tabLive
            ? t('tabEnded')
            : t('recording');

  const left = idle ? (
    <div className="vc-live">
      <button
        type="button"
        className="vc-live-btn is-idle"
        disabled={!canRecord || rec.state === 'starting' || recordingElsewhere || otherRecorder}
        aria-busy={rec.state === 'starting' || undefined}
        onClick={start}
      >
        <MicIcon size={15} />
        <span className="vc-live-label">{d.segments.length ? t('resume') : t('start')}</span>
      </button>
      <button
        type="button"
        className="vc-live-toggle"
        aria-label={t('transcriptOpen')}
        title={t('transcriptOpen')}
        aria-expanded={dock === 'transcript'}
        onClick={() => setDock((cur) => (cur === 'transcript' ? 'none' : 'transcript'))}
      >
        <Chevron up={dock !== 'transcript'} />
      </button>
    </div>
  ) : (
    <div className="vc-live is-live">
      <button
        type="button"
        className="vc-live-btn"
        aria-label={t('transcriptOpen')}
        aria-expanded={dock === 'transcript'}
        title={status}
        onClick={() => setDock((cur) => (cur === 'transcript' ? 'none' : 'transcript'))}
      >
        <span className="vc-rec-dot" aria-hidden="true" />
        <LevelBars level={rec.level} />
        <span className="vc-rec-time data" role="timer">
          {formatDuration(rec.elapsed)}
        </span>
        <Chevron up={dock !== 'transcript'} />
      </button>
      <button type="button" className="vc-stop-btn" aria-label={t('stop')} title={t('stop')} disabled={rec.state === 'stopping'} onClick={() => void stopRecording()}>
        <span aria-hidden="true" />
      </button>
    </div>
  );

  const livePanel = (
    <section
      className="vc-livepanel"
      aria-label={t('transcriptTitle')}
      data-testid="voice-live-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          setDock('none');
        }
      }}
    >
      <header className="vc-livepanel-head">
        <h2 className="vc-askpanel-title">{t('transcriptTitle')}</h2>
        {!idle && (
          <span className="vc-muted vc-livepanel-status" role="status">
            {status}
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('transcriptClose')} title={`${t('transcriptClose')} (Esc)`} onClick={() => setDock('none')}>
          <Chevron up={false} />
        </button>
      </header>
      {idle && canRecord && (
        <div className="vc-livepanel-setup">
          <fieldset className="vc-mode" disabled={rec.state === 'starting'}>
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
          {mode === 'mic_tab' && <p className="vc-muted">{desktop ? t('systemHelp') : t('tabHelp')}</p>}
        </div>
      )}
      <div className="vc-panel">
        <TranscriptPanel
          segments={d.segments}
          speakers={d.speakers}
          onRenameSpeaker={(k, n) => void renameSpeaker(k, n)}
          recording={recording}
          deletedAt={d.transcriptDeletedAt}
          focus={focus}
        />
      </div>
      <p className="vc-muted vc-consent">{t('consent')}</p>
    </section>
  );

  const aboveBar =
    dock === 'transcript' ? (
      livePanel
    ) : notesBusy && !recording ? (
      <p className="vc-dock-status" role="status">
        <span className="vc-spin" aria-hidden="true" />
        {t('notesQueued')}
      </p>
    ) : !recording && hasContent && !d.enhanced && ai ? (
      <div className="vc-dock-cta">
        <button type="button" className="btn btn-primary btn-sm" disabled={enhancing} aria-busy={enhancing || undefined} onClick={() => void enhance(d.templateKey)}>
          {enhancing ? t('enhancing') : t('enhance')}
        </button>
      </div>
    ) : rec.lagging || (recording && recorder.mode === 'mic_tab' && !rec.tabLive) ? (
      <p className="vc-dock-status" role="status">
        {status}
      </p>
    ) : null;

  const templateLabel = (key: string) => ((VOICE_BUILTIN_TEMPLATES as readonly string[]).includes(key) ? tTpl(key) : (templates.find((x) => x.id === key)?.name ?? key));

  return (
    <div className="app-page ui-page vc-page vc-meeting vc-doc-page">
      <div className="vc-doc-top">
        <Link href="/app/voice" className="ui-page-back">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {t('back')}
        </Link>
        <div className="vc-doc-actions">
          <span className="vc-muted vc-save" role="status">
            {saveState === 'saving' ? t('saving') : saveState === 'saved' ? t('saved') : saveState === 'error' ? t('saveError') : ''}
          </span>
          <Pop menu align="end" ariaLabel={t('more')} buttonClass="btn btn-ghost btn-sm btn-icon" panelClass="vc-menu" label={<DotsIcon />} testId="voice-more">
            {(close) => (
              <>
                <MenuItem disabled={busy !== null || !hasContent} onClick={() => {
                  close();
                  void send('markdown');
                }}>
                  {t('copyMarkdown')}
                </MenuItem>
                <MenuItem disabled={busy !== null || !hasContent} onClick={() => {
                  close();
                  setDocsDialog(true);
                }}>
                  {t('sendDocs')}
                </MenuItem>
                <MenuItem disabled={busy !== null || !hasContent} onClick={() => {
                  close();
                  void send('notes');
                }}>
                  {t('sendNotes')}
                </MenuItem>
                <MenuItem disabled={busy !== null || !hasNotes} onClick={() => {
                  close();
                  setModal('send');
                }}>
                  {t('sendSlackNotion')}
                </MenuItem>
                <span className="vc-menu-sep" role="separator" />
                <MenuItem disabled={busy !== null || !transcription || recording} onClick={() => {
                  close();
                  fileRef.current?.click();
                }}>
                  {busy === 'import' ? t('importing') : t('import')}
                </MenuItem>
                <MenuItem onClick={() => {
                  close();
                  setModal('details');
                }}>{t('crmLinks')}</MenuItem>
                <span className="vc-menu-sep" role="separator" />
                <MenuItem danger disabled={busy !== null || recording} onClick={() => {
                  close();
                  setConfirmDelete(true);
                }}>
                  {t('delete')}
                </MenuItem>
              </>
            )}
          </Pop>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => setModal('share')}>
            {d.share ? t('shared') : t('share')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('copyLink')} title={t('copyLink')} onClick={() => void copyLink()}>
            <LinkIcon />
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="audio/*,video/webm,video/mp4" className="sr-only" tabIndex={-1} aria-label={t('import')} onChange={(e) => void onFile(e.target.files?.[0])} />

      <article className="vc-doc">
        <div className="vc-doc-notices">
          {!transcription ? <p className="vc-notice">{tErr('transcribe_disabled')}</p> : !support.rec ? <p className="vc-notice">{t('unsupported')}</p> : null}
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
          {recError && (
            <p className="ui-error" role="alert">
              {tErr(voiceErrorKey(recError))}
            </p>
          )}
          {otherRecorder && (
            <p className="vc-notice" role="status">
              {t('otherRecorder')}
            </p>
          )}
          {recordingElsewhere && (
            <p className="vc-notice" role="status">
              {t('recordingElsewhere')} <Link href={`/app/voice/meetings/${recorder.sessionId}`}>{t('openOther')}</Link>
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
        </div>

        <input
          className="vc-doc-title"
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

        <div className="vc-chips">
          <Pop
            menu
            panelLabel={t('viewLabel')}
            panelClass="vc-menu"
            testId="voice-view-chip"
            label={
              <>
                <NotesIcon ai={showingEnhanced} />
                <span>{showingEnhanced ? t('viewAi') : t('viewMine')}</span>
                <Chevron up={false} small />
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem radio checked={showingEnhanced} disabled={!d.enhanced} onClick={() => {
                  close();
                  setView('enhanced');
                }}>
                  {t('viewAi')}
                </MenuItem>
                <MenuItem radio checked={!showingEnhanced} onClick={() => {
                  close();
                  setView('mine');
                }}>
                  {t('viewMine')}
                </MenuItem>
                <span className="vc-menu-sep" role="separator" />
                <span className="vc-menu-label" aria-hidden="true">
                  {t('template')}
                </span>
                {[...VOICE_BUILTIN_TEMPLATES, ...templates.map((x) => x.id)].map((key) => (
                  <MenuItem
                    key={key}
                    radio
                    checked={d.templateKey === key}
                    onClick={() => {
                      close();
                      setD((prev) => ({ ...prev, templateKey: key }));
                      void patch({ templateKey: key });
                    }}
                  >
                    {templateLabel(key)}
                  </MenuItem>
                ))}
                <span className="vc-menu-sep" role="separator" />
                <MenuItem disabled={enhancing || recording || !hasContent || !ai} onClick={() => {
                  close();
                  void enhance(d.templateKey);
                }}>
                  {d.enhanced ? t('regenerateWith', { template: templateLabel(d.templateKey) }) : t('enhance')}
                </MenuItem>
              </>
            )}
          </Pop>
          <MeetingPeople
            sessionId={d.id}
            startedAt={d.startedAt}
            attendees={d.attendees}
            eventKey={d.eventKey}
            canAutoLink={!d.eventKey && !d.calBookingId && d.attendees.length === 0 && !d.enhanced}
            onAttendees={(a) => void onAttendees(a)}
            onLinked={onLinked}
          />
          <Pop
            menu
            panelLabel={t('folder')}
            panelClass="vc-menu"
            testId="voice-folder-chip"
            label={
              <>
                <FolderIcon />
                <span className="vc-chip-text">{folder ? folder.name : t('addToFolder')}</span>
              </>
            }
          >
            {(close) => (
              <>
                {topFolders.map((f) => [
                  <MenuItem key={f.id} radio checked={d.folderId === f.id} onClick={() => {
                  close();
                  void moveTo(f.id);
                }}>
                    {f.name}
                  </MenuItem>,
                  ...folders
                    .filter((x) => x.parentId === f.id)
                    .map((x) => (
                      <MenuItem key={x.id} radio checked={d.folderId === x.id} onClick={() => {
                  close();
                  void moveTo(x.id);
                }}>
                        {`${f.name} / ${x.name}`}
                      </MenuItem>
                    )),
                ])}
                {d.folderId && <MenuItem onClick={() => {
                  close();
                  void moveTo(null);
                }}>{t('removeFromFolder')}</MenuItem>}
                {folders.length > 0 && <span className="vc-menu-sep" role="separator" />}
                <form
                  className="vc-menu-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement;
                    const name = input.value;
                    close();
                    void createFolder(name);
                  }}
                >
                  <input name="name" className="input input-sm" maxLength={80} placeholder={t('newFolder')} aria-label={t('newFolder')} />
                </form>
              </>
            )}
          </Pop>
        </div>

        {(d.brief || ((d.attendees.length > 0 || !!d.contactId) && !d.enhanced)) && (
          <BriefPanel key={`${d.attendees.length}:${d.contactId ?? ''}`} sessionId={d.id} initial={d.brief} canBrief={d.attendees.length > 0 || !!d.contactId} />
        )}

        <section className="vc-doc-body" aria-label={showingEnhanced ? t('aiNotes') : t('myNotes')}>
          {showingEnhanced ? (
            <EnhancedNotes sessionId={d.id} enhanced={d.enhanced!} hasContact={!!d.contactId} onSaveState={setSaveState} />
          ) : (
            <textarea
              className="vc-doc-notes"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={t('notesPlaceholder')}
              aria-label={t('myNotes')}
              data-voice-context="note"
            />
          )}
          {!ai && <p className="vc-muted">{tErr('ai_disabled')}</p>}
        </section>
      </article>

      <MeetingAsk
        sessionId={d.id}
        initial={d.chat}
        ai={chatAi}
        live={recording}
        open={dock === 'ask'}
        onOpenChange={onDockOpen}
        onSeek={seek}
        left={left}
        above={aboveBar}
        models={chatModels}
        followup={d.followup}
        defaultTo={[...d.attendees.map((a) => a.email), ...(d.contact?.email ? [d.contact.email] : [])].filter(Boolean)}
        mailbox={mailbox}
        onFollowupSaved={(followup) => setD((p) => ({ ...p, followup }))}
      />

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
      {modal === 'send' && <SendModal sessionId={d.id} onClose={() => setModal(null)} />}
      {modal === 'details' && (
        <VoiceModal title={t('crmLinks')} onClose={() => setModal(null)} closeLabel={t('close')} testId="voice-details">
          <DetailsPanel
            compact
            sessionId={d.id}
            calBookingId={d.calBookingId}
            contact={d.contact}
            crmActivityId={d.crmActivityId}
            docsPageId={d.docsPageId}
            noteId={d.noteId}
            attendees={d.attendees}
            onAttendees={(a) => void onAttendees(a)}
            onLinked={(p) => {
              setD((prev) => ({
                ...prev,
                ...(p.contact !== undefined ? { contact: p.contact, contactId: p.contact?.id ?? null } : {}),
                ...(p.crmActivityId !== undefined ? { crmActivityId: p.crmActivityId } : {}),
              }));
            }}
          />
        </VoiceModal>
      )}
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

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  radio,
  checked,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  radio?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? !!checked : undefined}
      className={`vc-menu-item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="vc-menu-text">{children}</span>
      {radio && checked && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
    </button>
  );
}

function Chevron({ up, small }: { up: boolean; small?: boolean }) {
  const s = small ? 12 : 14;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3.5 6.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function NotesIcon({ ai }: { ai: boolean }) {
  return ai ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
    </svg>
  );
}
