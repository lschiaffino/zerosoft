'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ImportJobDto } from '@/lib/inbox/import-jobs';
import { api, longWhen, notifyInboxChanged } from './api';

interface ExportFile {
  format: string;
  version: number;
  folders?: unknown[];
  chatFolders?: unknown[];
  chats?: unknown[];
  scheduled?: unknown[];
  drafts?: unknown[];
  snoozes?: unknown[];
  notes?: unknown[];
  messages?: unknown[];
}

const CHUNK = 500;
/** Bytes del archivo que se leen por vez al importar desde el navegador (servidor sin Blob). */
const WINDOW = 1024 * 1024;
const ACTIVE = new Set(['running', 'waiting']);

type Counts = Record<string, number>;

function sumInto(sum: Counts, r: Counts) {
  for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] ?? 0) + v;
}

function resumeKey(f: File) {
  return `zs-inbox-import:${f.name}:${f.size}:${f.lastModified}`;
}

function readOffset(f: File): number {
  try {
    return Number(localStorage.getItem(resumeKey(f)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeOffset(f: File, n: number | null) {
  try {
    if (n === null) localStorage.removeItem(resumeKey(f));
    else localStorage.setItem(resumeKey(f), String(n));
  } catch {
    /* sin almacenamiento: no se retoma */
  }
}

/**
 * Ajustes › Importar: todo el historial de WhatsApp desde el servidor y la
 * exportación de inbox-zero. Las importaciones largas siguen solas en el
 * servidor (cron) y se pueden pausar; con la pantalla abierta avanzan más
 * rápido porque la pantalla también pide pasos.
 */
export default function ImportPanel({ whatsappConnected, gmailConnected = false, onDone }: { whatsappConnected: boolean; gmailConnected?: boolean; onDone: () => void }) {
  const t = useTranslations('inbox.settings.import');
  const te = useTranslations('inbox.errors');
  const locale = useLocale();
  const [jobs, setJobs] = useState<ImportJobDto[] | null>(null);
  const [mode, setMode] = useState<'blob' | 'server'>('server');
  const [listErr, setListErr] = useState(false);
  const [err, setErr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [legacy, setLegacy] = useState<ExportFile | null>(null);
  const [busy, setBusy] = useState<'' | 'upload' | 'local' | 'legacy' | 'start' | 'gmail'>('');
  const [progress, setProgress] = useState<{ done: number; total: number; unit: 'bytes' | 'parts' } | null>(null);
  const [result, setResult] = useState<Counts | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const errText = useCallback((code?: string) => (code && te.has(code) ? te(code) : te('generic')), [te]);

  const load = useCallback(async () => {
    const r = await api<{ imports: ImportJobDto[]; upload: { mode: 'blob' | 'server' } }>('/api/inbox/import');
    if (!r.ok) {
      setListErr(true);
      return;
    }
    setListErr(false);
    setJobs(r.data.imports);
    setMode(r.data.upload.mode);
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // Con la pantalla abierta, la importación activa avanza de a pasos (además del cron).
  const activeId = jobs?.find((j) => ACTIVE.has(j.status))?.id ?? null;
  const activeStatus = jobs?.find((j) => j.id === activeId)?.status;
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    const tick = async () => {
      while (!stop && alive.current) {
        const r = await api<{ import: ImportJobDto }>('/api/inbox/import', { method: 'POST', json: { action: 'step', id: activeId } });
        if (stop || !alive.current) return;
        if (r.ok) {
          setJobs((js) => (js ?? []).map((j) => (j.id === activeId ? r.data.import : j)));
          if (!ACTIVE.has(r.data.import.status)) {
            notifyInboxChanged();
            onDone();
            return;
          }
        }
        await new Promise((res) => setTimeout(res, r.ok && r.data.import.status === 'running' ? 800 : 8000));
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [activeId, activeStatus, onDone]);

  const act = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    const r = await api<{ import: ImportJobDto }>('/api/inbox/import', { method: 'POST', json: { action, id } });
    if (!r.ok) {
      setErr(errText(r.data.error));
      return;
    }
    setJobs((js) => (js ?? []).map((j) => (j.id === id ? r.data.import : j)));
  };

  const startWhatsapp = async () => {
    setErr('');
    setBusy('start');
    const r = await api<{ import: ImportJobDto }>('/api/inbox/import', { method: 'POST', json: { action: 'whatsapp' } });
    setBusy('');
    if (!r.ok) {
      setErr(errText(r.data.error));
      return;
    }
    setJobs((js) => [r.data.import, ...(js ?? []).filter((j) => j.id !== r.data.import.id)]);
  };

  const pick = async (f: File | undefined) => {
    setErr('');
    setResult(null);
    setLegacy(null);
    setFile(null);
    if (!f) return;
    if (/\.ndjson$/i.test(f.name)) {
      // Se mira solo la primera línea (el archivo puede ser enorme).
      const head = await f.slice(0, Math.min(f.size, 4 * 1024 * 1024)).text();
      try {
        const first = JSON.parse(head.split('\n')[0]) as { part?: string; format?: string };
        if (first.part !== 'meta' || first.format !== 'inbox-zero-export') throw new Error('format');
        setFile(f);
      } catch {
        setErr(te('invalid_file'));
      }
      return;
    }
    try {
      const data = JSON.parse(await f.text()) as ExportFile;
      if (data?.format !== 'inbox-zero-export' || data.version !== 1) throw new Error('format');
      setLegacy(data);
      setFile(f);
    } catch {
      setErr(te('invalid_file'));
    }
  };

  const finish = (sum: Counts | null) => {
    setProgress(null);
    setBusy('');
    if (sum) setResult(sum);
    setFile(null);
    setLegacy(null);
    if (input.current) input.current.value = '';
    onDone();
    notifyInboxChanged();
  };

  /** NDJSON con Blob: sube directo (en partes) y la importación sigue en el servidor. */
  const uploadAndImport = async (f: File) => {
    setBusy('upload');
    setProgress({ done: 0, total: f.size, unit: 'bytes' });
    try {
      const { upload } = await import('@vercel/blob/client');
      const safe = f.name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.ndjson$/i, '').slice(-100) || 'export';
      const blob = await upload(`inbox-import/${safe}.ndjson`, f, {
        access: 'public',
        handleUploadUrl: '/api/inbox/upload',
        contentType: 'application/x-ndjson',
        multipart: f.size > 32 * 1024 * 1024,
        onUploadProgress: (e) => alive.current && setProgress({ done: e.loaded, total: e.total || f.size, unit: 'bytes' }),
      });
      const r = await api<{ import: ImportJobDto }>('/api/inbox/import', { method: 'POST', json: { action: 'file', url: blob.url, name: f.name, size: f.size } });
      if (!r.ok) throw new Error(r.data.error ?? 'generic');
      setJobs((js) => [r.data.import, ...(js ?? []).filter((j) => j.id !== r.data.import.id)]);
      setProgress(null);
      setBusy('');
      setFile(null);
      if (input.current) input.current.value = '';
    } catch (e) {
      setProgress(null);
      setBusy('');
      setErr(errText(e instanceof Error && te.has(e.message) ? e.message : 'upload_failed'));
    }
  };

  /** NDJSON sin Blob: el navegador lee el archivo de a pedazos y manda cada línea. Se retoma donde quedó. */
  const importLocally = async (f: File) => {
    setBusy('local');
    const sum: Counts = {};
    let offset = readOffset(f);
    if (offset >= f.size) offset = 0;
    setProgress({ done: offset, total: f.size, unit: 'bytes' });
    while (offset < f.size && alive.current) {
      let buf = new Uint8Array(await f.slice(offset, offset + WINDOW).arrayBuffer());
      let end = buf.lastIndexOf(0x0a);
      if (end < 0 && offset + buf.length < f.size) {
        // Una línea más larga que la ventana: se lee hasta su fin.
        buf = new Uint8Array(await f.slice(offset, offset + 16 * WINDOW).arrayBuffer());
        end = buf.lastIndexOf(0x0a);
        if (end < 0) {
          setErr(te('invalid_file'));
          finish(sum);
          return;
        }
      }
      const cut = end < 0 ? buf.length : end + 1;
      const lines = new TextDecoder().decode(buf.subarray(0, cut)).split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const r = await fetch('/api/inbox/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: line }).catch(() => null);
        const data = (await r?.json().catch(() => ({}))) as { result?: Counts; error?: string };
        if (!r?.ok) {
          setErr(t('partialBytes', { pct: Math.floor((offset / f.size) * 100) }) + (data?.error ? ` ${errText(data.error)}` : ''));
          finish(sum);
          return;
        }
        if (data.result) sumInto(sum, data.result);
      }
      offset += cut;
      writeOffset(f, offset);
      setProgress({ done: offset, total: f.size, unit: 'bytes' });
    }
    writeOffset(f, null);
    finish(sum);
  };

  /** Formato viejo (.json): el navegador lo lee entero y lo manda en partes. */
  const importLegacy = async (file: ExportFile) => {
    setBusy('legacy');
    const messages = Array.isArray(file.messages) ? file.messages : [];
    const total = 1 + Math.ceil(messages.length / CHUNK);
    setProgress({ done: 0, total, unit: 'parts' });
    const sum: Counts = {};
    const meta = await api<{ result: Counts }>('/api/inbox/import', {
      method: 'POST',
      json: { part: 'meta', format: file.format, version: file.version, folders: file.folders ?? [], chatFolders: file.chatFolders ?? [], chats: file.chats ?? [], scheduled: file.scheduled ?? [], drafts: file.drafts ?? [], snoozes: file.snoozes ?? [], notes: file.notes ?? [] },
    });
    if (!meta.ok) {
      setErr(errText(meta.data.error));
      setProgress(null);
      setBusy('');
      return;
    }
    sumInto(sum, meta.data.result);
    for (let i = 0; i < messages.length; i += CHUNK) {
      setProgress({ done: 1 + i / CHUNK, total, unit: 'parts' });
      const r = await api<{ result: Counts }>('/api/inbox/import', { method: 'POST', json: { part: 'messages', messages: messages.slice(i, i + CHUNK) } });
      if (!r.ok) {
        setErr(t('partial', { done: Math.floor(i / CHUNK), total: total - 1 }));
        finish(sum);
        return;
      }
      sumInto(sum, r.data.result);
    }
    finish(sum);
  };

  const run = () => {
    if (!file || busy) return;
    setErr('');
    setResult(null);
    if (legacy) void importLegacy(legacy);
    else if (mode === 'blob') void uploadAndImport(file);
    else void importLocally(file);
  };

  const count = (k: keyof ExportFile) => (Array.isArray(legacy?.[k]) ? (legacy?.[k] as unknown[]).length : 0);
  const mb = (n: number) => (n / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 });
  const waJob = jobs?.find((j) => j.kind === 'whatsapp' && (ACTIVE.has(j.status) || j.status === 'paused'));
  const gmailJob = jobs?.find((j) => j.kind === 'gmail' && (ACTIVE.has(j.status) || j.status === 'paused'));
  const startGmail = async () => {
    setErr('');
    setBusy('gmail');
    const r = await api<{ import: ImportJobDto }>('/api/inbox/import', { method: 'POST', json: { action: 'gmail' } });
    setBusy('');
    if (!r.ok) {
      setErr(errText(r.data.error));
      return;
    }
    await load();
  };

  return (
    <section className="ib-section" id="import" aria-labelledby="ib-import-h">
      <h2 className="ib-h2" id="ib-import-h">
        {t('title')}
      </h2>

      <div className="ib-import-block">
        <h3 className="ib-h3">{t('waTitle')}</h3>
        <p className="ib-help">{t('waHelp')}</p>
        <div className="ib-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void startWhatsapp()} disabled={!whatsappConnected || busy === 'start' || !!waJob}>
            {busy === 'start' ? t('starting') : t('waStart')}
          </button>
          {!whatsappConnected && <span className="ib-help">{t('waNeedsLink')}</span>}
        </div>
        <p className="ib-help">{t('waLimit')}</p>
      </div>

      <div className="ib-import-block">
        <h3 className="ib-h3">{t('gmailTitle')}</h3>
        <p className="ib-help">{t('gmailHelp')}</p>
        <div className="ib-row">
          <button type="button" className="btn btn-secondary btn-sm" data-testid="inbox-import-gmail" onClick={() => void startGmail()} disabled={!gmailConnected || busy === 'gmail' || !!gmailJob}>
            {busy === 'gmail' ? t('starting') : t('gmailStart')}
          </button>
          {!gmailConnected && <span className="ib-help">{t('gmailNeedsLink')}</span>}
        </div>
      </div>

      <div className="ib-import-block">
        <h3 className="ib-h3">{t('izTitle')}</h3>
        <p className="ib-help">{t('help')}</p>
        <ol className="ib-steps">
          <li>{t('step1')}</li>
          <li>
            {t('step2')}
            <pre className="ib-code">node scripts/inbox-zero-export.mjs ~/inbox-zero --desktop</pre>
            <span className="ib-help">{t('step2Help')}</span>
          </li>
          <li>{t('step3')}</li>
        </ol>
        <div className="ui-field">
          <label className="label" htmlFor="ib-import-file">
            {t('file')}
          </label>
          <input id="ib-import-file" ref={input} type="file" accept=".ndjson,application/x-ndjson,application/json,.json" className="input" disabled={!!busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
        {file && (
          <div className="ib-import-summary" role="status">
            <p>
              <strong>{file.name}</strong> <span className="ib-dim">{t('size', { mb: mb(file.size) })}</span>
            </p>
            {legacy && (
              <p className="ib-help">
                {t('summary', { folders: count('folders'), chats: count('chats'), scheduled: count('scheduled'), drafts: count('drafts'), snoozes: count('snoozes'), notes: count('notes'), messages: count('messages') })}
              </p>
            )}
            {!legacy && readOffset(file) > 0 && readOffset(file) < file.size && mode === 'server' && <p className="ib-help">{t('resumeHint', { pct: Math.floor((readOffset(file) / file.size) * 100) })}</p>}
            <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={!!busy}>
              {t('run')}
            </button>
          </div>
        )}
        {progress && (
          <div className="ib-import-progress" role="status" aria-live="polite">
            <progress max={progress.total} value={progress.done} aria-label={t('progressLabel')} />
            <span className="ib-help">
              {progress.unit === 'parts'
                ? t('progress', { done: progress.done, total: progress.total })
                : busy === 'upload'
                  ? t('uploadingPct', { pct: Math.floor((progress.done / Math.max(progress.total, 1)) * 100) })
                  : t('importingPct', { pct: Math.floor((progress.done / Math.max(progress.total, 1)) * 100) })}
            </span>
          </div>
        )}
        {result && (
          <p className="ib-ok" role="status">
            {t('result', { folders: result.folders ?? 0, chats: result.chats ?? 0, scheduled: result.scheduled ?? 0, drafts: result.drafts ?? 0, snoozes: result.snoozes ?? 0, notes: result.notes ?? 0, messages: result.messages ?? 0 })}
          </p>
        )}
      </div>

      {err && (
        <p className="ui-error" role="alert">
          {err}
        </p>
      )}

      <div className="ib-import-block">
        <h3 className="ib-h3">{t('jobsTitle')}</h3>
        {listErr ? (
          <p className="ui-error" role="alert">
            {t('jobsError')}{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
              {t('retry')}
            </button>
          </p>
        ) : jobs === null ? (
          <p className="ib-help" aria-busy="true">
            {t('loading')}
          </p>
        ) : jobs.length === 0 ? (
          <p className="ib-help">{t('jobsEmpty')}</p>
        ) : (
          <ul className="ib-jobs" aria-label={t('jobsTitle')}>
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} onAct={(a) => void act(j.id, a)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function JobRow({ job, onAct }: { job: ImportJobDto; onAct: (a: 'pause' | 'resume' | 'cancel') => void }) {
  const t = useTranslations('inbox.settings.import');
  const te = useTranslations('inbox.errors');
  const locale = useLocale();
  const p = job.progress;
  const pct =
    job.kind === 'file'
      ? Math.floor(((p.bytes ?? 0) / Math.max(p.total ?? 1, 1)) * 100)
      : job.status === 'done'
        ? 100
        : p.chats
          ? Math.floor(((p.chatsDone ?? 0) / Math.max(p.chats, 1)) * 100)
          : 0;
  const detail =
    job.kind === 'file'
      ? t('jobFile', { messages: p.messages ?? 0, pct })
      : job.kind === 'gmail'
        ? t('jobGmail', { done: p.chatsDone ?? 0, chats: Math.max(p.chats ?? 0, p.chatsDone ?? 0), messages: p.messages ?? 0 })
        : t('jobWa', { done: p.chatsDone ?? 0, chats: p.chats ?? 0, messages: p.messages ?? 0 });
  const why =
    job.error === 'history_syncing'
      ? t('whySyncing')
      : job.error === 'not_connected'
        ? t(job.kind === 'gmail' ? 'whyGmailNotConnected' : 'whyNotConnected')
        : job.error === 'rate_limited' && job.kind === 'gmail'
          ? t('whyGmailSlow')
          : job.error
            ? te.has(job.error)
              ? te(job.error)
              : te('generic')
            : '';
  return (
    <li className={`ib-job is-${job.status}`}>
      <div className="ib-job-head">
        <strong className="ib-job-name">{job.kind === 'whatsapp' ? t('waTitle') : job.kind === 'gmail' ? t('gmailJobName', { address: job.sourceName }) : job.sourceName}</strong>
        <span className="ib-job-status">{t(`status.${job.status}`)}</span>
      </div>
      {job.status !== 'cancelled' && <progress max={100} value={pct} aria-label={t('progressOf', { name: job.kind === 'whatsapp' ? t('waTitle') : job.sourceName })} />}
      <p className="ib-help">
        {detail}
        {job.finishedAt ? ` · ${longWhen(job.finishedAt, locale)}` : ''}
      </p>
      {why && job.status !== 'done' && job.status !== 'cancelled' && <p className={job.status === 'failed' ? 'ib-error' : 'ib-help'}>{why}</p>}
      {(job.status === 'running' || job.status === 'waiting' || job.status === 'paused' || job.status === 'failed') && (
        <div className="ib-row">
          {job.status === 'paused' || job.status === 'failed' ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAct('resume')}>
              {job.status === 'failed' ? t('retry') : t('resume')}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAct('pause')}>
              {t('pause')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAct('cancel')}>
            {t('cancel')}
          </button>
        </div>
      )}
    </li>
  );
}
