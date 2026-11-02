'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { parseDbUtc } from '@/lib/utils';
import { parseCsv } from '@/lib/robots-csv';
import type { RobotBatchSummary, RobotUsage } from '@/lib/robots';
import { recorderBookmarklet, recorderLabels } from '@/lib/robots-recorder';
import { batchRowsCovered, MAX_BATCH_BYTES, MAX_BATCH_INPUTS, MAX_BULK_INPUTS, type RobotInputDef, type RobotStep } from '@/lib/robots-schema';
import { errorText, RobotDialog } from './robots-ui';

/** Resumen corto de un paso ("Ir a URL · https://…") para las vistas previas. */
function useStepSummary() {
  const t = useTranslations('robots.steps');
  return (s: RobotStep) => {
    const r = s as Record<string, unknown>;
    const detail = String(r.url ?? r.selector ?? r.text ?? r.name ?? '').slice(0, 80);
    return `${t(`types.${s.type}`)}${detail ? ` · ${detail}` : ''}`;
  };
}

// ---------- Pasos en lenguaje natural ----------

export function NlStepsDialog({
  open,
  onClose,
  defaultUrl,
  inputs,
  robotId,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  defaultUrl: string;
  inputs: RobotInputDef[];
  /** Robot que se edita: sus logins no piden revisión. */
  robotId: string;
  onAdd: (steps: RobotStep[], mode: 'append' | 'replace') => void;
}) {
  const t = useTranslations('robots.nl');
  const tr = useTranslations('robots');
  const summary = useStepSummary();
  const uid = useId();
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState(defaultUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<RobotStep[] | null>(null);
  const [review, setReview] = useState<number[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [mode, setMode] = useState<'append' | 'replace'>('append');

  async function generate() {
    setBusy(true);
    setError(null);
    setSteps(null);
    setReview([]);
    setReviewed(false);
    const res = await fetch('/api/robots/ai/steps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description, url: url.startsWith('http') ? url : '', inputs: inputs.map((i) => i.name), robotId }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { steps?: RobotStep[]; review?: number[]; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.steps) {
      setError(errorText(tr, data?.error));
      return;
    }
    if (!data.steps.length) setError(t('empty'));
    setSteps(data.steps);
    setReview(data.review ?? []);
  }

  return (
    <RobotDialog
      open={open}
      busy={busy}
      onClose={onClose}
      title={t('title')}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          {steps && steps.length > 0 ? (
            <button type="button" className="btn btn-primary" disabled={review.length > 0 && !reviewed} onClick={() => onAdd(steps, mode)}>
              {mode === 'replace' ? t('replace') : t('append')}
            </button>
          ) : (
            <button type="submit" form={`${uid}-form`} className="btn btn-primary" disabled={busy || !description.trim()} aria-busy={busy || undefined}>
              {busy ? t('generating') : t('generate')}
            </button>
          )}
        </>
      }
    >
      <form
        id={`${uid}-form`}
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <p className="robots-muted robots-small">{t('desc')}</p>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-d`}>
            {t('label')}
          </label>
          <textarea
            id={`${uid}-d`}
            className="textarea"
            rows={4}
            autoFocus
            maxLength={3000}
            value={description}
            placeholder={t('placeholder', { example: '{{inputs.query}}' })}
            onChange={(e) => {
              setDescription(e.target.value);
              setSteps(null);
            }}
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-u`}>
            {t('url')}
          </label>
          <input id={`${uid}-u`} className="input data" type="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
          <p className="ui-help">{t('urlHint')}</p>
        </div>
      </form>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {steps && steps.length > 0 && (
        <div className="robots-block">
          <p className="robots-h3" role="status">
            {t('preview', { count: steps.length })}
          </p>
          <ol className="robots-preview-steps">
            {steps.map((s, i) => (
              <li key={i} className="data">
                {summary(s)}
                {review.includes(i) && <span className="badge badge-warn"> {t('review')}</span>}
              </li>
            ))}
          </ol>
          {review.length > 0 && (
            <label className="ui-check">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              <span>{t('reviewConfirm')}</span>
            </label>
          )}
          <fieldset className="robots-radios">
            <legend className="sr-only">{t('append')}</legend>
            {(['append', 'replace'] as const).map((m) => (
              <label key={m} className="robots-radio">
                <input type="radio" name={`${uid}-mode`} checked={mode === m} onChange={() => setMode(m)} />
                <span>{t(m)}</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </RobotDialog>
  );
}

// ---------- Correr en lote desde un CSV ----------

export function BulkRunDialog({
  open,
  onClose,
  robotId,
  inputs,
  onQueued,
  usage,
  avgRunMs,
}: {
  open: boolean;
  onClose: () => void;
  robotId: string;
  inputs: RobotInputDef[];
  onQueued: (count: number) => void;
  usage: RobotUsage;
  /** Duración media de las corridas buenas (null si todavía no hay). */
  avgRunMs: number | null;
}) {
  const t = useTranslations('robots.bulk');
  const tr = useTranslations('robots');
  const uid = useId();
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const batch = useRef<{ key: string; id: string; offset: number } | null>(null);

  const table = useMemo(() => {
    if (!text.trim()) return null;
    const rows = parseCsv(text, MAX_BATCH_INPUTS + 2);
    if (rows.length < 2) return { head: rows[0] ?? [], body: [] as string[][] };
    return { head: rows[0], body: rows.slice(1) };
  }, [text]);

  // Columna sugerida: la que se llama como la entrada (o su etiqueta).
  const columnFor = (d: RobotInputDef): string => {
    if (mapping[d.name] !== undefined) return mapping[d.name];
    const head = table?.head ?? [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return head.find((h) => norm(h) === norm(d.name) || (d.label && norm(h) === norm(d.label))) ?? (inputs.length === 1 && head.length === 1 ? head[0] : '');
  };

  const body = table?.body.slice(0, MAX_BATCH_INPUTS) ?? [];

  async function start() {
    if (!table) return;
    setBusy(true);
    setError(null);
    const values = body.map((r) => {
      const o: Record<string, string> = {};
      for (const d of inputs) {
        const col = columnFor(d);
        const idx = col ? table.head.indexOf(col) : -1;
        if (idx >= 0 && r[idx] !== undefined && r[idx] !== '') o[d.name] = r[idx];
      }
      return o;
    });
    // En partes de hasta 1.000 filas y 3,5 MB (Vercel corta a 4,5 MB). Reintentar sigue desde la que falló:
    // mismo batchId y offset, y el servidor no duplica lo que ya entró.
    // Antes de subir nada: todas las filas tienen lo obligatorio.
    const missingAt = values.findIndex((v) => inputs.some((d) => d.required && !d.default && !v[d.name]));
    if (missingAt >= 0) {
      const d = inputs.find((x) => x.required && !x.default && !values[missingAt][x.name]);
      setBusy(false);
      setError(t('rowMissing', { row: missingAt + 1, name: d?.label || d?.name || '' }));
      return;
    }
    if (JSON.stringify(values).length > MAX_BATCH_BYTES) {
      setBusy(false);
      setError(tr('errors.batch_too_large'));
      return;
    }
    // Otro CSV u otro mapeo es otro lote. Lo subido de un intento anterior no arranca nunca: el servidor lo descarta.
    const key = JSON.stringify([text, inputs.map((d) => columnFor(d))]);
    const batchId = batch.current?.key === key ? batch.current.id : crypto.randomUUID();
    batch.current = { key, id: batchId, offset: batch.current?.key === key ? batch.current.offset : 0 };
    let total = 0;
    let offset = batch.current.offset;
    while (offset < values.length) {
      const chunk: Array<Record<string, string>> = [];
      let bytes = 0;
      while (offset + chunk.length < values.length && chunk.length < MAX_BULK_INPUTS) {
        const size = JSON.stringify(values[offset + chunk.length]).length + 1;
        if (chunk.length && bytes + size > 3_500_000) break;
        chunk.push(values[offset + chunk.length]);
        bytes += size;
      }
      const res = await fetch(`/api/robots/${robotId}/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: chunk, batchId, offset, total: values.length }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { total?: number; error?: string; name?: string; index?: number } | null;
      if (!res?.ok || !data?.total) {
        setBusy(false);
        setProgress(null);
        setError(`${errorText(tr, data?.error, { name: data?.name ?? '', index: (data?.index ?? 0) + 1 })} ${t('nothingStarted')}`);
        return;
      }
      total = data.total;
      offset += chunk.length;
      batch.current.offset = offset;
      setProgress({ done: offset, total: values.length });
    }
    setBusy(false);
    setProgress(null);
    batch.current = null;
    if (!total) return;
    setText('');
    setMapping({});
    onQueued(total);
  }

  return (
    <RobotDialog
      open={open}
      busy={busy}
      onClose={onClose}
      title={t('title')}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !body.length || !inputs.length} aria-busy={busy || undefined} onClick={() => void start()}>
            {t('start', { count: body.length })}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <p className="robots-muted robots-small">{t('desc', { max: MAX_BATCH_INPUTS.toLocaleString() })}</p>
        {inputs.length === 0 && <p className="robots-note-warn">{t('noInputs')}</p>}
        {progress && (
          <p className="robots-muted robots-small" role="status">
            {t('progress', { done: progress.done, total: progress.total })}
          </p>
        )}
        {body.length > 0 && (
          <BatchEstimate rows={body.length} usage={usage} avgRunMs={avgRunMs} />
        )}
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-file`}>
            {t('file')}
          </label>
          <input
            id={`${uid}-file`}
            className="input"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 100 * 1024 * 1024) {
                setError(t('parseError'));
                return;
              }
              void f.text().then((v) => {
                setText(v);
                setMapping({});
                setError(null);
              });
            }}
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-paste`}>
            {t('paste')}
          </label>
          <textarea
            id={`${uid}-paste`}
            className="textarea data"
            rows={4}
            value={text.length > 200_000 ? '' : text}
            readOnly={text.length > 200_000}
            spellCheck={false}
            placeholder={inputs.length ? `${inputs.map((i) => i.name).join(',')}\n…` : ''}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {table && table.head.length > 0 && (
          <>
            <p className="robots-muted robots-small" role="status">
              {t('rows', { count: table.body.length })}
              {table.body.length > MAX_BATCH_INPUTS ? ` · ${t('tooMany', { max: MAX_BATCH_INPUTS })}` : ''}
            </p>
            {inputs.length > 0 && (
              <fieldset className="robots-mapping">
                <legend className="label">{t('map')}</legend>
                <div className="robots-fields">
                  {inputs.map((d) => (
                    <div key={d.name} className="ui-field">
                      <label className="label" htmlFor={`${uid}-m-${d.name}`}>
                        {d.label || d.name}
                      </label>
                      <select
                        id={`${uid}-m-${d.name}`}
                        className="select"
                        value={columnFor(d)}
                        onChange={(e) => setMapping({ ...mapping, [d.name]: e.target.value })}
                      >
                        <option value="">{t('useDefault')}</option>
                        {table.head.map((h, i) => (
                          <option key={`${h}-${i}`} value={h}>
                            {h || `#${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="ui-help">{t('mapHint')}</p>
              </fieldset>
            )}
            {body.length > 0 && (
              <div className="table-wrap robots-scroll">
                <table className="table table-compact">
                  <caption className="sr-only">{t('preview')}</caption>
                  <thead>
                    <tr>
                      {table.head.map((h, i) => (
                        <th key={i} scope="col">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {table.head.map((_, j) => (
                          <td key={j}>{r[j] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {text.trim() && (!table || table.body.length === 0) && <p className="ui-error">{t('parseError')}</p>}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </RobotDialog>
  );
}

// ---------- Armar con IA (desde la lista) ----------

interface Built {
  name: string;
  description: string;
  steps: RobotStep[];
  sample: Array<Record<string, string>>;
  columns: string[];
}

export function AiBuilderDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (b: Built) => Promise<boolean> }) {
  const t = useTranslations('robots.builder');
  const tr = useTranslations('robots');
  const summary = useStepSummary();
  const uid = useId();
  const [url, setUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState<'read' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiOff, setAiOff] = useState(false);
  const [built, setBuilt] = useState<Built | null>(null);
  const [none, setNone] = useState(false);

  async function read() {
    setBusy('read');
    setError(null);
    setBuilt(null);
    setNone(false);
    setAiOff(false);
    const res = await fetch('/api/robots/ai/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, goal }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { robot?: Built; detected?: Built | null; error?: string } | null;
    setBusy(null);
    if (!res?.ok) {
      setError(errorText(tr, data?.error));
      return;
    }
    if (data?.robot) {
      setBuilt(data.robot);
      return;
    }
    // Sin IA: el error queda a la vista y se ofrece la lista detectada.
    if (data?.error) {
      setError(errorText(tr, data.error));
      setAiOff(true);
    }
    if (data?.detected) setBuilt(data.detected);
    else setNone(true);
  }

  async function create() {
    if (!built) return;
    setBusy('create');
    const ok = await onCreate(built);
    if (!ok) setBusy(null);
  }

  return (
    <RobotDialog
      open={open}
      busy={busy !== null}
      onClose={onClose}
      title={t('title')}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy !== null}>
            {t('cancel')}
          </button>
          {built ? (
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy !== null} aria-busy={busy === 'create' || undefined}>
              {busy === 'create' ? t('creating') : aiOff ? t('useDetected') : t('create')}
            </button>
          ) : (
            <button type="submit" form={`${uid}-form`} className="btn btn-primary" disabled={busy !== null || !url.trim()} aria-busy={busy === 'read' || undefined}>
              {busy === 'read' ? t('reading') : t('read')}
            </button>
          )}
        </>
      }
    >
      <form
        id={`${uid}-form`}
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void read();
        }}
      >
        <p className="robots-muted robots-small">{t('desc')}</p>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-url`}>
            {t('url')}
          </label>
          <input
            id={`${uid}-url`}
            className="input data"
            type="url"
            required
            autoFocus
            value={url}
            placeholder="https://"
            onChange={(e) => {
              setUrl(e.target.value);
              setBuilt(null);
            }}
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-goal`}>
            {t('goal')}
          </label>
          <textarea
            id={`${uid}-goal`}
            className="textarea"
            rows={2}
            maxLength={2000}
            value={goal}
            placeholder={t('goalPlaceholder')}
            onChange={(e) => {
              setGoal(e.target.value);
              setBuilt(null);
            }}
          />
        </div>
      </form>
      {error && (
        <p className={aiOff ? 'robots-note-warn' : 'ui-error'} role="alert">
          {error}
          {aiOff && built ? ` ${t('aiOff')}` : ''}
        </p>
      )}
      {none && <p className="robots-note-warn">{t('none')}</p>}
      {built && (
        <div className="robots-block" aria-live="polite">
          <p className="robots-h3">{built.name}</p>
          <p className="robots-muted robots-small">{t('steps', { list: built.steps.map(summary).join(' → ') })}</p>
          <p className="robots-muted robots-small">{t('found', { count: built.columns.length })}</p>
          {built.sample.length > 0 ? (
            <div className="table-wrap robots-scroll">
              <table className="table table-compact">
                <thead>
                  <tr>
                    {built.columns.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {built.sample.map((r, i) => (
                    <tr key={i}>
                      {built.columns.map((c) => (
                        <td key={c}>{r[c] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="robots-muted robots-small">{t('noSample')}</p>
          )}
        </div>
      )}
    </RobotDialog>
  );
}

/** Cuánto va a tardar y gastar un lote, antes de arrancarlo. */
function BatchEstimate({ rows, usage, avgRunMs }: { rows: number; usage: RobotUsage; avgRunMs: number | null }) {
  const t = useTranslations('robots.bulk');
  const seconds = (avgRunMs ?? 30_000) / 1000;
  const minutes = Math.ceil((rows * seconds) / 60);
  // Tiempo de reloj: los minutos repartidos entre las corridas a la vez.
  const wallMinutes = Math.ceil(minutes / Math.max(usage.concurrency, 1));
  const wall = wallMinutes < 60 ? t('wallMinutes', { count: wallMinutes }) : t('wallHours', { count: Math.ceil(wallMinutes / 60) });
  const left = usage.minutesLimit === null ? null : Math.max(0, Math.floor(usage.minutesLimit - usage.minutesUsed));
  const covered = left === null ? rows : batchRowsCovered(left, seconds, rows);
  const exp = usage.batchExpiry ?? { unit: 'days', count: 45 };
  const age = exp.unit === 'days' ? t('days', { count: exp.count }) : t('hours', { count: exp.count });
  return (
    <div className="robots-small" data-testid="robots-batch-estimate">
      <p className="robots-muted">{t('estimate', { minutes, wall, seconds: Math.round(seconds), concurrency: usage.concurrency })}</p>
      {left !== null &&
        (covered < rows ? (
          <p className="robots-note-warn" data-testid="robots-batch-cover">
            {t('cover', { left, covered, rows })}
          </p>
        ) : (
          <p className="robots-muted" data-testid="robots-batch-cover">
            {t('coverAll', { left, rows })}
          </p>
        ))}
      <p className="robots-muted">{t('expiry', { age })}</p>
    </div>
  );
}

/**
 * Grabar en vivo: abre una grabación y muestra los pasos a medida que llegan
 * del sitio (bookmarklet de esta grabación o extensión). Nada entra al robot
 * hasta tocar Agregar.
 */
export function RecordDialog({
  open,
  onClose,
  robotId,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  robotId: string;
  onAdd: (steps: RobotStep[], mode: 'append' | 'replace') => void;
}) {
  const t = useTranslations('robots.record');
  const tr = useTranslations('robots.recorder');
  const trr = useTranslations('robots');
  const summary = useStepSummary();
  const [rec, setRec] = useState<{ id: string; token: string; sendUrl: string } | null>(null);
  const [steps, setSteps] = useState<RobotStep[]>([]);
  const [review, setReview] = useState<number[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let id: string | null = null;
    setSteps([]);
    setReview([]);
    setReviewed(false);
    setError(null);
    setRec(null);
    void (async () => {
      const res = await fetch(`/api/robots/${robotId}/recording`, { method: 'POST' }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { id?: string; token?: string; sendUrl?: string; error?: string } | null;
      if (!alive) return;
      if (!res?.ok || !data?.id || !data.token || !data.sendUrl) {
        setError(errorText(trr, data?.error));
        return;
      }
      id = data.id;
      setRec({ id: data.id, token: data.token, sendUrl: data.sendUrl });
      timer = setInterval(() => {
        void fetch(`/api/robots/recordings/${data.id}`)
          .then((r) => (r.ok ? (r.json() as Promise<{ steps: RobotStep[]; review?: number[] }>) : null))
          .then((d) => {
            if (!alive || !d) return;
            setSteps(d.steps);
            setReview(d.review ?? []);
          })
          .catch(() => {});
      }, 1500);
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      // La grabación no sirve más: se borra (y su token deja de valer).
      if (id) void fetch(`/api/robots/recordings/${id}`, { method: 'DELETE' }).catch(() => {});
    };
  }, [open, robotId, trr]);

  const labels = useMemo(() => recorderLabels((k, v) => tr(k as never, v as never)), [tr]);
  // React 19 bloquea href="javascript:…": se asigna directo en el DOM.
  useEffect(() => {
    if (rec) linkRef.current?.setAttribute('href', recorderBookmarklet(labels, { url: rec.sendUrl, token: rec.token }));
  }, [rec, labels]);

  async function copyCode() {
    if (!rec) return;
    await navigator.clipboard?.writeText(`${rec.sendUrl}#${rec.token}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <RobotDialog
      open={open}
      onClose={onClose}
      title={t('title')}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!steps.length || (review.length > 0 && !reviewed)}
            onClick={() => onAdd(steps, mode)}
          >
            {t('add', { count: steps.length })}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {error && (
          <p className="robots-note-warn" role="alert">
            {error}
          </p>
        )}
        {!rec && !error && <p className="robots-muted robots-small">{t('opening')}</p>}
        {rec && (
          <>
            <p className="robots-muted robots-small">{t('desc')}</p>
            <div className="ui-field">
              <span className="label">{t('bookmarkletLabel')}</span>
              <div className="robots-inline">
                <a ref={linkRef} className="btn btn-secondary btn-sm robots-bookmarklet" draggable onClick={(e) => e.preventDefault()} data-testid="robots-record-bookmarklet">
                  {t('bookmarklet')}
                </a>
              </div>
              <p className="ui-help">{t('bookmarkletHint')}</p>
            </div>
            <div className="ui-field">
              <span className="label">{t('extensionLabel')}</span>
              <div className="robots-inline">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyCode()}>
                  {copied ? t('copied') : t('copyCode')}
                </button>
                <a className="robots-link" href="/api/robots/recorder-extension" download>
                  {t('download')}
                </a>
              </div>
              <p className="ui-help">{t('extensionHint')}</p>
            </div>
            <div aria-live="polite">
              <p className="robots-small robots-muted">{steps.length ? t('received', { count: steps.length }) : t('waiting')}</p>
              {steps.length > 0 && (
                <ol className="robots-run-extras" data-testid="robots-record-steps">
                  {steps.map((s, i) => (
                    <li key={i} className={review.includes(i) ? 'robots-log-warn' : undefined}>
                      {summary(s)}
                      {review.includes(i) ? ` · ${t('reviewStep')}` : ''}
                    </li>
                  ))}
                </ol>
              )}
              {review.length > 0 && (
                <label className="robots-inline robots-review-tick">
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                  <span>{t('reviewConfirm')}</span>
                </label>
              )}
            </div>
            <fieldset className="robots-radios">
              <legend className="label">{t('modeLabel')}</legend>
              {(['append', 'replace'] as const).map((m) => (
                <label key={m} className="robots-radio">
                  <input type="radio" name="record-mode" checked={mode === m} onChange={() => setMode(m)} />
                  <span>{t(m)}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}
      </div>
    </RobotDialog>
  );
}

/** Lotes del robot con su avance. Cancelar pide confirmación: saca de la cola lo que falta. */
export function BatchesPanel({ robotId, initial, canRun, refreshKey }: { robotId: string; initial: RobotBatchSummary[]; canRun: boolean; refreshKey: number }) {
  const t = useTranslations('robots.batches');
  const tr = useTranslations('robots');
  const format = useFormatter();
  const [batches, setBatches] = useState(initial);
  const [confirm, setConfirm] = useState<RobotBatchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/robots/${robotId}/bulk`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { batches?: RobotBatchSummary[] } | null;
    if (res?.ok && data?.batches) setBatches(data.batches);
  }, [robotId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const live = batches.some((b) => b.counts.queued + b.counts.running > 0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [live, load]);

  async function cancel() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/robots/batches/${confirm.id}`, { method: 'DELETE' }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) {
      setError(errorText(tr, data?.error));
      return;
    }
    setConfirm(null);
    await load();
  }

  if (!batches.length) return null;
  return (
    <section className="robots-block robots-batches-block" aria-labelledby="robots-batches-title">
      <h3 className="robots-h3" id="robots-batches-title">
        {t('title')}
      </h3>
      <ul className="robots-batches">
        {batches.map((b) => (
          <li key={b.id} className="robots-batch" data-testid="robots-batch">
            <span className="robots-small">
              <span suppressHydrationWarning>{format.dateTime(parseDbUtc(b.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
              {' · '}
              {t('progress', { done: b.counts.success + b.counts.failed, total: b.total, failed: b.counts.failed })}
              {b.paused && <span className="robots-note-warn"> · {t('paused')}</span>}
              {b.firstRunId && (
                <>
                  {' · '}
                  <a className="robots-link" href={`?tab=runs&run=${b.firstRunId}`}>
                    {t('open')}
                  </a>
                </>
              )}
            </span>
            {canRun && b.canCancel && b.counts.queued > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(b)}>
                {t('cancel')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <RobotDialog
        open={!!confirm}
        busy={busy}
        onClose={() => setConfirm(null)}
        title={t('confirmTitle')}
        foot={
          <>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>
              {t('keep')}
            </button>
            <button type="button" className="btn btn-primary btn-danger" disabled={busy} onClick={() => void cancel()}>
              {t('confirm')}
            </button>
          </>
        }
      >
        <p>{t('confirmBody', { count: confirm?.counts.queued ?? 0 })}</p>
        {error && (
          <p className="robots-note-warn" role="alert">
            {error}
          </p>
        )}
      </RobotDialog>
    </section>
  );
}
