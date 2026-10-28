'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parseCsv } from '@/lib/robots-csv';
import { MAX_BULK_INPUTS, type RobotInputDef, type RobotStep } from '@/lib/robots-schema';
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
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  defaultUrl: string;
  inputs: RobotInputDef[];
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
  const [mode, setMode] = useState<'append' | 'replace'>('append');

  async function generate() {
    setBusy(true);
    setError(null);
    setSteps(null);
    const res = await fetch('/api/robots/ai/steps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description, url: url.startsWith('http') ? url : '', inputs: inputs.map((i) => i.name) }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { steps?: RobotStep[]; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.steps) {
      setError(errorText(tr, data?.error));
      return;
    }
    if (!data.steps.length) setError(t('empty'));
    setSteps(data.steps);
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
            <button type="button" className="btn btn-primary" onClick={() => onAdd(steps, mode)}>
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
              </li>
            ))}
          </ol>
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
}: {
  open: boolean;
  onClose: () => void;
  robotId: string;
  inputs: RobotInputDef[];
  onQueued: (count: number) => void;
}) {
  const t = useTranslations('robots.bulk');
  const tr = useTranslations('robots');
  const uid = useId();
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const table = useMemo(() => {
    if (!text.trim()) return null;
    const rows = parseCsv(text, MAX_BULK_INPUTS + 1);
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

  const body = table?.body.slice(0, MAX_BULK_INPUTS) ?? [];

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
    const res = await fetch(`/api/robots/${robotId}/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: values }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { total?: number; error?: string; name?: string; index?: number } | null;
    setBusy(false);
    if (!res?.ok || !data?.total) {
      setError(errorText(tr, data?.error, { name: data?.name ?? '' }));
      return;
    }
    setText('');
    setMapping({});
    onQueued(data.total);
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
        <p className="robots-muted robots-small">{t('desc', { max: MAX_BULK_INPUTS.toLocaleString() })}</p>
        {inputs.length === 0 && <p className="robots-note-warn">{t('noInputs')}</p>}
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
              if (f.size > 5 * 1024 * 1024) {
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
            value={text}
            spellCheck={false}
            placeholder={inputs.length ? `${inputs.map((i) => i.name).join(',')}\n…` : ''}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {table && table.head.length > 0 && (
          <>
            <p className="robots-muted robots-small" role="status">
              {t('rows', { count: table.body.length })}
              {table.body.length > MAX_BULK_INPUTS ? ` · ${t('tooMany', { max: MAX_BULK_INPUTS })}` : ''}
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
