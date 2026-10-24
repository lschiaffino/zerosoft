'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Lo que comparten los importadores de Track, Cal y Docs en el navegador: el
 * job (crear, avanzar en loop mientras se mira, confirmar, cancelar, retomar
 * uno en curso al volver) y la barra de progreso. Cada app pone su formulario,
 * su vista previa y su reporte.
 */

export type ImportStatus = 'uploading' | 'fetching' | 'preview' | 'importing' | 'done' | 'failed' | 'cancelled';

export interface ImportJobView {
  id: string;
  app: 'track' | 'cal' | 'docs';
  source: string;
  status: ImportStatus;
  stage: string;
  total: number;
  processed: number;
  preview: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  error: string | null;
  options: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

const RUNNING: ImportStatus[] = ['fetching', 'importing'];

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

export function useImportJob(app: ImportJobView['app']) {
  const [job, setJob] = useState<ImportJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const looping = useRef<string | null>(null);

  /** Avanza el job pidiendo tramos hasta que deje de trabajar (o se desmonte). */
  const drive = useCallback(async (id: string) => {
    if (looping.current === id) return;
    looping.current = id;
    try {
      for (let fails = 0; alive.current && looping.current === id; ) {
        const res = await api<{ job: ImportJobView | null }>(`/api/import/jobs/${id}/run`, { method: 'POST', body: '{}' }).catch(() => null);
        if (!alive.current || looping.current !== id) return;
        if (!res?.ok || !res.data.job) {
          // Un corte de red no corta el import: el cron lo sigue; acá se reintenta unas veces.
          if (++fails >= 5) {
            setError(res?.data.error ?? 'source_unreachable');
            return;
          }
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        fails = 0;
        setJob(res.data.job);
        if (!RUNNING.includes(res.data.job.status)) return;
        // Con el job tomado por otra corrida (o esperando un 429) no se insiste en seguida.
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      if (looping.current === id) looping.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    (async () => {
      const res = await api<{ jobs: ImportJobView[] }>(`/api/import/jobs?app=${app}`).catch(() => null);
      if (!alive.current) return;
      setLoading(false);
      // Retoma el último si sigue abierto (lectura, vista previa o escritura).
      const open = res?.ok ? res.data.jobs.find((j) => ['fetching', 'preview', 'importing'].includes(j.status)) : undefined;
      if (open) {
        setJob(open);
        if (RUNNING.includes(open.status)) void drive(open.id);
      }
    })();
    return () => {
      alive.current = false;
      looping.current = null;
    };
  }, [app, drive]);

  const create = useCallback(
    async (body: Record<string, unknown>): Promise<ImportJobView | null> => {
      setError(null);
      const res = await api<{ job: ImportJobView }>('/api/import/jobs', { method: 'POST', body: JSON.stringify({ app, ...body }) }).catch(() => null);
      if (!res?.ok) {
        setError(res?.data.error ?? 'source_unreachable');
        return null;
      }
      setJob(res.data.job);
      if (RUNNING.includes(res.data.job.status)) void drive(res.data.job.id);
      return res.data.job;
    },
    [app, drive],
  );

  /** Para la subida por partes de Docs: cerrar la subida y empezar a leer. */
  const finishUpload = useCallback(
    async (id: string) => {
      const res = await api<{ job: ImportJobView }>(`/api/import/jobs/${id}/run`, { method: 'POST', body: JSON.stringify({ uploaded: true }) }).catch(() => null);
      if (!res?.ok) {
        setError(res?.data.error ?? 'upload_failed');
        return;
      }
      setJob(res.data.job);
      if (RUNNING.includes(res.data.job.status)) void drive(id);
    },
    [drive],
  );

  const start = useCallback(async () => {
    if (!job) return;
    setError(null);
    const res = await api<{ job: ImportJobView }>(`/api/import/jobs/${job.id}/start`, { method: 'POST', body: '{}' }).catch(() => null);
    if (!res?.ok) {
      setError(res?.data.error ?? 'source_unreachable');
      return;
    }
    setJob(res.data.job);
    if (RUNNING.includes(res.data.job.status)) void drive(job.id);
  }, [job, drive]);

  const cancel = useCallback(async () => {
    if (!job) return;
    looping.current = null;
    await api(`/api/import/jobs/${job.id}`, { method: 'DELETE' }).catch(() => null);
    setJob(null);
  }, [job]);

  const reset = useCallback(() => {
    looping.current = null;
    setJob(null);
    setError(null);
  }, []);

  return { job, setJob, error, setError, loading, create, start, cancel, reset, finishUpload };
}

/** Texto de un código de error de import. */
export function useImportErrorText() {
  const t = useTranslations('common.importJob');
  return (code: string | null | undefined) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
}

/**
 * El job falló leyendo la fuente (antes de la vista previa: todavía no se
 * escribió nada). La pantalla vuelve al formulario con lo cargado, para
 * corregir el token sin tipear todo de nuevo.
 */
export function failedReading(job: ImportJobView | null): boolean {
  return job?.status === 'failed' && !job.report;
}

/** "No pudimos leer Linear: el token fue rechazado…" */
export function useReadFailedText() {
  const t = useTranslations('common.importJob');
  const errorText = useImportErrorText();
  return (source: string, code: string | null | undefined) => {
    const reason = errorText(code);
    return t('readFailed', { source, reason: reason.charAt(0).toLowerCase() + reason.slice(1) });
  };
}

/** Barra de progreso + estado + cancelar, para leer, subir o escribir. */
export function ImportProgress({
  job,
  uploadPercent,
  onCancel,
  stageLabel,
}: {
  job: ImportJobView | null;
  /** 0 a 100 mientras sube un archivo (antes de que exista el job o con el job en 'uploading'). */
  uploadPercent?: number | null;
  onCancel?: () => void;
  stageLabel?: (stage: string) => string | null;
}) {
  const t = useTranslations('common.importJob');
  const uploading = uploadPercent !== null && uploadPercent !== undefined;
  const importing = job?.status === 'importing';
  const pct = uploading ? uploadPercent : importing && job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : null;
  const label = uploading
    ? t('uploading', { percent: uploadPercent })
    : importing
      ? t('importing', { processed: job.processed, total: job.total })
      : t('reading', { count: job?.total ?? 0 });
  const stage = importing && stageLabel ? stageLabel(job.stage) : null;
  return (
    <div className="ximp-progress" role="status" aria-live="polite" data-testid="import-progress">
      <div className="ximp-progress-head">
        <span className="ximp-spinner" aria-hidden="true" />
        <span>{label}</span>
        {stage && <span className="ui-help">{stage}</span>}
      </div>
      <div className="ximp-bar" aria-hidden="true" data-indeterminate={pct === null || undefined}>
        <span style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      <p className="ui-help">{t('keepsGoing')}</p>
      {onCancel && (
        <div>
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            {t('cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Una fila "número + rótulo" de la vista previa o el reporte. */
export function ImportStat({ value, label }: { value: ReactNode; label: string }) {
  const locale = useLocale();
  return (
    <div className="ximp-stat">
      <span className="ximp-stat-value data">{typeof value === 'number' ? value.toLocaleString(locale) : value}</span>
      <span className="ximp-stat-label">{label}</span>
    </div>
  );
}

/** Pie de la vista previa: importar o cancelar. */
export function ImportConfirm({ label, onConfirm, onCancel, disabled }: { label: string; onConfirm: () => Promise<void> | void; onCancel: () => void; disabled?: boolean }) {
  const t = useTranslations('common.importJob');
  const [busy, setBusy] = useState(false);
  return (
    <div className="ximp-actions">
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={async () => {
          setBusy(true);
          await onConfirm();
          setBusy(false);
        }}
      >
        {label}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        {t('cancel')}
      </button>
    </div>
  );
}
