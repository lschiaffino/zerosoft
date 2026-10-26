'use client';

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';
import DocsGlyph from './DocsGlyphs';

interface MeetingAction {
  text: string;
  owner: string;
  due: string;
  sent?: { kind: 'track' | 'crm'; id: string; label: string; url: string };
}

interface Meeting {
  id: string;
  title: string;
  status: 'idle' | 'recording' | 'ready' | 'error';
  transcript: string;
  summary: string;
  decisions: string[];
  actions: MeetingAction[];
  durationSec: number;
  error: string | null;
}

interface Props {
  block: DocsBlock;
  index: number;
  focused: boolean;
  pageId: string | null;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
}

/** Un trozo por minuto (los tests lo acortan con window.__docsMeetingChunkMs). */
function chunkMs(): number {
  const n = Number((globalThis as { __docsMeetingChunkMs?: number }).__docsMeetingChunkMs);
  return Number.isFinite(n) && n >= 500 ? n : 60_000;
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

const LANGS = ['', 'en', 'es', 'pt', 'fr', 'de', 'it'] as const;

/**
 * Notas de reunión con IA (como el bloque /meet de Notion): graba el
 * micrófono y, si se comparte, el audio de la pestaña de la llamada
 * (getDisplayMedia), manda un trozo por minuto a transcribir y al terminar
 * arma resumen, decisiones y tareas, que se pueden mandar a Track o al CRM.
 * También acepta una transcripción pegada. El audio no se guarda: solo el
 * texto transcripto.
 */
const DocsMeetingBlock = forwardRef<HTMLDivElement, Props>(({ block, index, focused, pageId, onChange, onKeyDown, onFocus }, ref) => {
  const t = useTranslations('docs.meeting');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [recording, setRecording] = useState(false);
  const [withTab, setWithTab] = useState(false);
  const [language, setLanguage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState<'summary' | 'tasks' | 'paste' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const streams = useRef<MediaStream[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const seq = useRef(0);
  const stopping = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const creating = useRef(false);
  const meetingId = block.meeting_id ?? null;

  // Sin reunión todavía: se crea al insertar el bloque.
  useEffect(() => {
    // Una sola vez por bloque (el id llega en el próximo render, después de onChange).
    if (meetingId || !pageId || creating.current) return;
    creating.current = true;
    fetch('/api/docs/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId, title: '' }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { meeting: Meeting }) => {
        setMeeting(d.meeting);
        onChange(index, { meeting_id: d.meeting.id });
      })
      .catch(() => {
        setLoadError(true);
        creating.current = false;
      });
  }, [meetingId, pageId, index, onChange]);

  useEffect(() => {
    if (!meetingId) return;
    let alive = true;
    fetch(`/api/docs/meetings/${encodeURIComponent(meetingId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { meeting: Meeting }) => {
        if (!alive) return;
        setMeeting(d.meeting);
        setTitle(d.meeting.title);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [meetingId]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const cleanup = useCallback(() => {
    for (const s of streams.current) for (const tr of s.getTracks()) tr.stop();
    streams.current = [];
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    recorder.current = null;
  }, []);
  useEffect(() => () => {
    stopping.current = true;
    recorder.current?.stop();
    cleanup();
  }, [cleanup]);

  const upload = useCallback(
    (blob: Blob, seconds: number) => {
      if (!meetingId || blob.size === 0) return;
      const n = seq.current++;
      setPending((p) => p + 1);
      queue.current = queue.current.then(async () => {
        const form = new FormData();
        form.set('audio', blob, `chunk-${n}.webm`);
        form.set('seconds', String(Math.max(1, Math.round(seconds))));
        form.set('seq', String(n));
        if (language) form.set('language', language);
        try {
          const res = await fetch(`/api/docs/meetings/${encodeURIComponent(meetingId)}/audio`, { method: 'POST', body: form });
          const d = (await res.json().catch(() => ({}))) as { meeting?: Meeting; error?: string };
          if (d.meeting) setMeeting(d.meeting);
          if (!res.ok) setError(d.error ?? 'transcribe_failed');
        } catch {
          setError('network');
        } finally {
          setPending((p) => p - 1);
        }
      });
    },
    [meetingId, language],
  );

  /** Graba trozos completos (cada uno un archivo válido): parar y volver a arrancar. */
  const startSegment = useCallback(
    (stream: MediaStream) => {
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
      const parts: Blob[] = [];
      const started = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      rec.onstop = () => {
        upload(new Blob(parts, { type: rec.mimeType || 'audio/webm' }), (Date.now() - started) / 1000);
        if (!stopping.current) startSegment(stream);
      };
      rec.start();
      recorder.current = rec;
      window.setTimeout(() => {
        if (rec.state === 'recording') rec.stop();
      }, chunkMs());
    },
    [upload],
  );

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('unsupported');
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streams.current = [mic];
      let mixed: MediaStream = mic;
      if (withTab && navigator.mediaDevices.getDisplayMedia) {
        // Audio de la pestaña de la llamada (Meet, Zoom web): hay que tildar "Compartir audio".
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).catch(() => null);
        if (display) {
          streams.current.push(display);
          for (const v of display.getVideoTracks()) v.stop();
          if (display.getAudioTracks().length) {
            const ctx = new AudioContext();
            audioCtx.current = ctx;
            const dest = ctx.createMediaStreamDestination();
            ctx.createMediaStreamSource(mic).connect(dest);
            ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
            mixed = dest.stream;
          } else setError('no_tab_audio');
        }
      }
      stopping.current = false;
      setElapsed(0);
      setRecording(true);
      startSegment(mixed);
    } catch {
      cleanup();
      setError('mic_denied');
    }
  };

  const generate = useCallback(async () => {
    if (!meetingId) return;
    setBusy('summary');
    setError(null);
    try {
      const res = await fetch(`/api/docs/meetings/${encodeURIComponent(meetingId)}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: language || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { meeting?: Meeting; content?: string; error?: string };
      if (!res.ok || !d.meeting) {
        setError(d.error ?? 'ai_error');
        return;
      }
      setMeeting(d.meeting);
      setTab('summary');
      if (d.content !== undefined) onChange(index, { content: d.content });
    } catch {
      setError('network');
    } finally {
      setBusy(null);
    }
  }, [meetingId, language, index, onChange]);

  const stop = async () => {
    stopping.current = true;
    recorder.current?.stop();
    setRecording(false);
    cleanup();
    // Cuando terminan de subir los trozos, se arman las notas.
    await queue.current;
    await generate();
  };

  const savePaste = async () => {
    if (!meetingId || !paste.trim()) return;
    setBusy('paste');
    try {
      const transcript = [meeting?.transcript, paste.trim()].filter(Boolean).join('\n');
      const res = await fetch(`/api/docs/meetings/${encodeURIComponent(meetingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const d = (await res.json().catch(() => ({}))) as { meeting?: Meeting };
      if (d.meeting) setMeeting(d.meeting);
      setPaste('');
      setPasting(false);
    } finally {
      setBusy(null);
    }
    await generate();
  };

  const saveTitle = (value: string) => {
    if (!meetingId || value === meeting?.title) return;
    void fetch(`/api/docs/meetings/${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: value }),
    });
    setMeeting((m) => (m ? { ...m, title: value } : m));
  };

  const loadProjects = () => {
    if (projects) return;
    fetch('/api/track/projects?meta=1')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: Array<{ id: string; name: string }> }) => {
        setProjects(d.rows ?? []);
        if (d.rows?.[0]) setProjectId(d.rows[0].id);
      })
      .catch(() => setProjects([]));
  };

  const send = async (target: 'track' | 'crm') => {
    if (!meetingId) return;
    setBusy('tasks');
    setError(null);
    try {
      const res = await fetch(`/api/docs/meetings/${encodeURIComponent(meetingId)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, projectId: target === 'track' ? projectId : undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { meeting?: Meeting; error?: string };
      if (d.meeting) setMeeting(d.meeting);
      if (!res.ok) setError(d.error ?? 'failed');
    } catch {
      setError('network');
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (!meetingId) return;
    setConfirmClear(false);
    const res = await fetch(`/api/docs/meetings/${encodeURIComponent(meetingId)}`, { method: 'DELETE' });
    const d = (await res.json().catch(() => ({}))) as { meeting?: Meeting };
    if (d.meeting) setMeeting(d.meeting);
    onChange(index, { content: '' });
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const hasNotes = Boolean(meeting && (meeting.summary || meeting.actions.length || meeting.decisions.length));
  const unsent = meeting?.actions.filter((a) => !a.sent).length ?? 0;
  const errorText = (code: string) =>
    ['ai_disabled', 'quota_exceeded', 'rate_limited', 'mic_denied', 'unsupported', 'no_tab_audio', 'transcript_too_short', 'meeting_too_long', 'project_not_found', 'network'].includes(code)
      ? t(`errors.${code}`)
      : t('errors.generic');

  return (
    <div
      ref={ref}
      className={`docs-block docs-meeting-block${focused ? ' focused' : ''}`}
      data-index={index}
      data-testid="docs-meeting-block"
      tabIndex={0}
      role="group"
      aria-label={t('label')}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget) onKeyDown(index, e);
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus(index);
      }}
    >
      <div className="docs-meeting-head">
        <DocsGlyph name="meeting" size={16} />
        <input
          className="docs-meeting-title"
          value={title}
          placeholder={t('titlePlaceholder')}
          aria-label={t('titleLabel')}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => saveTitle(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {recording ? (
          <span className="docs-meeting-rec" role="status">
            <span className="docs-meeting-dot" aria-hidden />
            {t('recording', { time: mmss(elapsed) })}
          </span>
        ) : meeting && meeting.durationSec > 0 ? (
          <span className="docs-meeting-meta">{t('duration', { time: mmss(meeting.durationSec) })}</span>
        ) : null}
      </div>

      {!pageId && <p className="ui-help">{t('noPage')}</p>}
      {loadError && (
        <p className="ui-error" role="alert">
          {t('errors.load')}
        </p>
      )}
      {pageId && !meeting && !loadError && (
        <p className="ui-help" role="status">
          {t('loading')}
        </p>
      )}

      {meeting && (
        <>
          <div className="docs-meeting-controls">
            {recording ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void stop()} data-testid="docs-meeting-stop">
                {t('stop')}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void start()} disabled={busy !== null} data-testid="docs-meeting-start">
                  {meeting.transcript ? t('resume') : t('start')}
                </button>
                <label className="ui-check docs-meeting-opt">
                  <input type="checkbox" checked={withTab} onChange={(e) => setWithTab(e.target.checked)} />
                  {t('withTab')}
                </label>
                <label className="docs-meeting-opt">
                  <span className="sr-only">{t('language')}</span>
                  <select className="select select-sm" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={t('language')}>
                    {LANGS.map((l) => (
                      <option key={l} value={l}>
                        {t(`languages.${l || 'auto'}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasting((v) => !v)} aria-expanded={pasting} data-testid="docs-meeting-paste-toggle">
                  {t('pasteTranscript')}
                </button>
                {meeting.transcript.trim() && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void generate()} disabled={busy !== null} aria-busy={busy === 'summary' || undefined} data-testid="docs-meeting-generate">
                    {busy === 'summary' ? t('generating') : hasNotes ? t('regenerate') : t('generate')}
                  </button>
                )}
                {(meeting.transcript || hasNotes) &&
                  (confirmClear ? (
                    <>
                      <span className="ui-help">{t('clearConfirm')}</span>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => void clear()} autoFocus>
                        {t('clear')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>
                        {t('cancel')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>
                      {t('clear')}
                    </button>
                  ))}
              </>
            )}
            {pending > 0 && (
              <span className="ui-help" role="status">
                {t('transcribing', { n: pending })}
              </span>
            )}
          </div>
          {!recording && !meeting.transcript && !hasNotes && <p className="ui-help docs-meeting-consent">{t('consent')}</p>}
          {recording && <p className="ui-help docs-meeting-consent">{t('consentRecording')}</p>}

          {pasting && (
            <div className="docs-meeting-paste">
              <label className="label" htmlFor={`mt-paste-${block.id}`}>
                {t('pasteLabel')}
              </label>
              <textarea
                id={`mt-paste-${block.id}`}
                className="textarea"
                rows={6}
                value={paste}
                placeholder={t('pastePlaceholder')}
                onChange={(e) => setPaste(e.target.value)}
                data-testid="docs-meeting-paste"
              />
              <div className="docs-meeting-row">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePaste()} disabled={!paste.trim() || busy !== null} data-testid="docs-meeting-paste-save">
                  {t('pasteSave')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasting(false)}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="ui-error" role="alert" data-testid="docs-meeting-error">
              {errorText(error)}
            </p>
          )}

          {(hasNotes || meeting.transcript) && (
            <div className="docs-meeting-tabs" role="tablist" aria-label={t('label')}>
              <button type="button" role="tab" aria-selected={tab === 'summary'} className={`docs-meeting-tab${tab === 'summary' ? ' active' : ''}`} onClick={() => setTab('summary')}>
                {t('summaryTab')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'transcript'} className={`docs-meeting-tab${tab === 'transcript' ? ' active' : ''}`} onClick={() => setTab('transcript')}>
                {t('transcriptTab')}
              </button>
            </div>
          )}

          {tab === 'summary' && hasNotes && (
            <div className="docs-meeting-notes" data-testid="docs-meeting-notes" role="tabpanel">
              {meeting.summary && (
                <section>
                  <h3>{t('summary')}</h3>
                  <p>{meeting.summary}</p>
                </section>
              )}
              {meeting.decisions.length > 0 && (
                <section>
                  <h3>{t('decisions')}</h3>
                  <ul>
                    {meeting.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <h3>{t('actions')}</h3>
                {meeting.actions.length === 0 ? (
                  <p className="ui-help">{t('noActions')}</p>
                ) : (
                  <ul className="docs-meeting-actions">
                    {meeting.actions.map((a, i) => (
                      <li key={i}>
                        <span>
                          {a.text}
                          {a.owner && <span className="docs-meeting-owner"> · {a.owner}</span>}
                          {a.due && <span className="docs-meeting-owner"> · {a.due}</span>}
                        </span>
                        {a.sent && (
                          <a href={a.sent.url} className="docs-meeting-sent">
                            {a.sent.kind === 'track' ? a.sent.label : t('crmTask')}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {unsent > 0 && (
                  <div className="docs-meeting-row docs-meeting-send">
                    <select
                      className="select select-sm"
                      aria-label={t('project')}
                      value={projectId}
                      onFocus={loadProjects}
                      onMouseDown={loadProjects}
                      onChange={(e) => setProjectId(e.target.value)}
                      data-testid="docs-meeting-project"
                    >
                      {!projects && <option value="">{t('pickProject')}</option>}
                      {projects?.length === 0 && <option value="">{t('noProjects')}</option>}
                      {projects?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null || !projectId} onClick={() => void send('track')} data-testid="docs-meeting-send-track">
                      {t('sendTrack', { n: unsent })}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void send('crm')} data-testid="docs-meeting-send-crm">
                      {t('sendCrm', { n: unsent })}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === 'summary' && !hasNotes && meeting.transcript && !busy && <p className="ui-help">{t('notYet')}</p>}
          {tab === 'transcript' && (
            <div className="docs-meeting-transcript" role="tabpanel" data-testid="docs-meeting-transcript">
              {meeting.transcript ? meeting.transcript.split('\n').map((l, i) => <p key={i}>{l}</p>) : <p className="ui-help">{t('noTranscript')}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
});
DocsMeetingBlock.displayName = 'DocsMeetingBlock';

export default DocsMeetingBlock;
