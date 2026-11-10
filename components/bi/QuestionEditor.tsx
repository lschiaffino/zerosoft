'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { paramNames } from '@/lib/bi/builder';
import { vizOptions } from '@/lib/bi/viz';
import { AGG_FNS, BUCKETS, FILTER_OPS, ZS_SOURCE, type BiResult, type BuilderQuery, type QueryParam, type SchemaTable, type Viz, type VizType } from '@/lib/bi/types';
import type { DatabaseDto, ListItem, QuestionDto } from '@/lib/bi/store';
import ResultView from './ResultView';
import SqlEditor from './SqlEditor';
import SharePanel from './SharePanel';
import BiDialog from './BiDialog';
import { biApi, biErrorText, notifyBiChanged } from './client';

type Mode = 'builder' | 'sql';

const ZS_JOIN_HINTS: Record<string, Array<{ table: string; left: string; right: string }>> = {
  contacts: [{ table: 'companies', left: 'company_id', right: 'id' }],
  issues: [{ table: 'projects', left: 'project_id', right: 'id' }],
  messages: [{ table: 'chats', left: 'chat_id', right: 'id' }],
};

const emptyBuilder = (table: string): BuilderQuery => ({ kind: 'builder', table, joins: [], filters: [], aggregations: [], breakouts: [], sort: [] });

export default function QuestionEditor({
  question,
  databases,
  initialSchema,
  isAdmin,
  aiAvailable,
  initialMode,
  initialAsk,
  collectionId,
}: {
  question: QuestionDto | null;
  databases: DatabaseDto[];
  initialSchema: SchemaTable[];
  isAdmin: boolean;
  aiAvailable: boolean;
  initialMode: Mode;
  initialAsk: string | null;
  collectionId: string | null;
}) {
  const t = useTranslations('bi');
  const locale = useLocale();
  const router = useRouter();
  const [id, setId] = useState(question?.id ?? null);
  const [name, setName] = useState(question?.name ?? '');
  const [source, setSource] = useState(question?.source ?? ZS_SOURCE);
  const [schema, setSchema] = useState<SchemaTable[]>(initialSchema);
  const [schemaError, setSchemaError] = useState(false);
  const [mode, setMode] = useState<Mode>(question ? (question.query.kind === 'sql' ? 'sql' : 'builder') : initialMode);
  const [builder, setBuilder] = useState<BuilderQuery>(question?.query.kind === 'builder' ? question.query : emptyBuilder(initialSchema[0]?.name ?? ''));
  const [sql, setSql] = useState(question?.query.kind === 'sql' ? question.query.sql : '');
  const [params, setParams] = useState<QueryParam[]>(question?.query.kind === 'sql' ? question.query.params : []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [viz, setViz] = useState<Viz>(question?.viz ?? { type: 'auto' });
  const [result, setResult] = useState<BiResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [compiled, setCompiled] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState(initialAsk ?? '');
  const [asking, setAsking] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'share' | 'delete' | 'dashboard' | null>(null);
  const [dashboards, setDashboards] = useState<ListItem[] | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const canEdit = question ? question.canEdit : true;
  const sqlAllowed = source === ZS_SOURCE || isAdmin || databases.find((d) => d.id === source)?.sqlAccess === 'members';
  const abort = useRef<AbortController | null>(null);

  // Variables del SQL: las que aparecen en el texto, con su tipo y valor por defecto.
  useEffect(() => {
    if (mode !== 'sql') return;
    const names = paramNames(sql);
    setParams((cur) => names.map((n) => cur.find((p) => p.name === n) ?? { name: n, type: 'text' as const }));
  }, [sql, mode]);

  const loadSchema = useCallback(async (src: string) => {
    try {
      const d = await biApi<{ tables: SchemaTable[] }>(`/api/bi/schema?source=${encodeURIComponent(src)}`);
      setSchema(d.tables);
      setSchemaError(false);
      return d.tables;
    } catch {
      setSchemaError(true);
      return [];
    }
  }, []);

  const query = useCallback((): BuilderQuery | { kind: 'sql'; sql: string; params: QueryParam[] } => (mode === 'sql' ? { kind: 'sql', sql, params } : builder), [mode, sql, params, builder]);

  const run = useCallback(
    async (opts: { fresh?: boolean; override?: { kind: 'sql'; sql: string; params: QueryParam[] } } = {}) => {
      const q = opts.override ?? query();
      if (q.kind === 'sql' ? !q.sql.trim() : !q.table) return;
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setRunning(true);
      setRunError(null);
      try {
        const d = await biApi<{ result: BiResult }>('/api/bi/query', { body: { source, query: q, values, fresh: opts.fresh === true }, signal: ctrl.signal });
        setResult(d.result);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setResult(null);
        setRunError(biErrorText(err, t));
      } finally {
        if (abort.current === ctrl) setRunning(false);
      }
    },
    [query, source, values, t],
  );

  // Preguntar en lenguaje natural: el SQL generado queda en el editor, a la vista, y se corre.
  const askAi = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setAsking(true);
      setRunError(null);
      try {
        const { answer } = await biApi<{ answer: { sql: string; title: string; explanation: string } }>('/api/bi/ask', { body: { question: text, source, locale } });
        setMode('sql');
        setSql(answer.sql);
        setParams([]);
        if (!name) setName(answer.title);
        setExplanation(answer.explanation);
        await run({ override: { kind: 'sql', sql: answer.sql, params: [] } });
      } catch (err) {
        setRunError(biErrorText(err, t));
      } finally {
        setAsking(false);
      }
    },
    [source, locale, name, run, t],
  );

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialAsk) void askAi(initialAsk);
    else if (question) void run();
  }, [initialAsk, question, askAi, run]);

  // Ver el SQL del constructor.
  useEffect(() => {
    if (mode !== 'builder' || !builder.table) {
      setCompiled(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      biApi<{ sql: string }>('/api/bi/compile', { body: { source, query: builder }, signal: ctrl.signal })
        .then((d) => setCompiled(d.sql))
        .catch(() => setCompiled(null));
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [builder, mode, source]);

  const save = async () => {
    const finalName = name.trim() || t('editor.untitled');
    setSaving(true);
    setSaveError(null);
    try {
      const body = { name: finalName, source, query: query(), viz, ...(id ? {} : { collectionId }) };
      if (id) {
        await biApi(`/api/bi/questions/${id}`, { method: 'PATCH', body });
      } else {
        const { question: q } = await biApi<{ question: QuestionDto }>('/api/bi/questions', { body });
        setId(q.id);
        router.replace(`/app/analytics/questions/${q.id}`);
      }
      setName(finalName);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      notifyBiChanged();
    } catch (err) {
      setSaveError(biErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  const columnsOf = useMemo(() => {
    const base = schema.find((tb) => tb.name === builder.table);
    const cols = (base?.columns ?? []).map((c) => ({ ref: c.name, label: c.name, type: c.type }));
    for (const j of builder.joins) {
      const tb = schema.find((x) => x.name === j.table);
      for (const c of tb?.columns ?? []) cols.push({ ref: `${tb!.name}.${c.name}`, label: `${tb!.name} · ${c.name}`, type: c.type });
    }
    return cols;
  }, [schema, builder.table, builder.joins]);

  const setB = (patch: Partial<BuilderQuery>) => setBuilder((b) => ({ ...b, ...patch }));
  const opts = result ? vizOptions(result.columns) : [];

  const switchMode = async (m: Mode) => {
    if (m === mode) return;
    if (m === 'sql' && mode === 'builder' && compiled && !sql.trim()) setSql(compiled);
    setMode(m);
    setResult(null);
  };

  return (
    <div className="app-page ui-page bi-page bi-editor">
      <div className="bi-editor-head">
        <label className="sr-only" htmlFor="bi-q-name">
          {t('editor.name')}
        </label>
        <input id="bi-q-name" className="bi-title-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('editor.untitled')} maxLength={200} readOnly={!canEdit} />
        <div className="bi-actions">
          {id && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setDialog('dashboard');
                  setDashError(null);
                  biApi<{ items: ListItem[] }>('/api/bi/items')
                    .then((d) => setDashboards(d.items.filter((i) => i.kind === 'dashboard')))
                    .catch((err) => {
                      setDashboards([]);
                      setDashError(biErrorText(err, t));
                    });
                }}
              >
                {t('editor.addToDashboard')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setDialog('share')}>
                {t('share.button')}
              </button>
              {canEdit && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDialog('delete')}>
                  {t('common.delete')}
                </button>
              )}
            </>
          )}
          {canEdit && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving} aria-busy={saving}>
              {saved ? t('editor.saved') : t('common.save')}
            </button>
          )}
        </div>
      </div>
      {saveError && (
        <p className="ui-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="bi-toolbar">
        <label className="bi-inline-field">
          <span className="label">{t('editor.source')}</span>
          <select
            className="input"
            value={source}
            onChange={async (e) => {
              const src = e.target.value;
              setSource(src);
              setResult(null);
              const tables = await loadSchema(src);
              setBuilder(emptyBuilder(tables[0]?.name ?? ''));
            }}
          >
            <option value={ZS_SOURCE}>{t('editor.zerosoft')}</option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="bi-tabs" role="tablist" aria-label={t('editor.mode')}>
          <button type="button" role="tab" aria-selected={mode === 'builder'} className={`bi-tab${mode === 'builder' ? ' active' : ''}`} onClick={() => void switchMode('builder')}>
            {t('editor.builder')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'sql'} className={`bi-tab${mode === 'sql' ? ' active' : ''}`} onClick={() => void switchMode('sql')} disabled={!sqlAllowed}>
            {t('editor.sql')}
          </button>
        </div>
      </div>
      {!sqlAllowed && <p className="bi-muted">{t('editor.sqlAdminsOnly')}</p>}
      {schemaError && (
        <p className="ui-error" role="alert">
          {t('errors.schema')}
        </p>
      )}

      <form
        className="bi-ask bi-ask-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void askAi(ask);
        }}
      >
        <label className="sr-only" htmlFor="bi-q-ask">
          {t('ask.label')}
        </label>
        <input id="bi-q-ask" className="input" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={t('ask.placeholder')} maxLength={1000} disabled={!aiAvailable || asking} />
        <button type="submit" className="btn btn-sm" disabled={!aiAvailable || asking || !ask.trim()} aria-busy={asking}>
          {asking ? t('ask.thinking') : t('ask.submit')}
        </button>
      </form>
      {!aiAvailable && <p className="bi-muted">{t('ask.unavailable')}</p>}
      {explanation && mode === 'sql' && (
        <p className="bi-explain" data-testid="bi-explanation">
          <strong>{t('ask.generated')}</strong> {explanation}
        </p>
      )}

      {mode === 'builder' ? (
        <Builder q={builder} set={setB} schema={schema} columns={columnsOf} source={source} />
      ) : (
        <>
          <SqlEditor value={sql} onChange={setSql} onRun={() => void run()} schema={schema} label={t('editor.sqlLabel')} />
          {params.length > 0 && (
            <fieldset className="bi-params">
              <legend>{t('editor.variables')}</legend>
              {params.map((p, i) => (
                <div key={p.name} className="bi-param">
                  <code>{`{{${p.name}}}`}</code>
                  <select
                    className="input"
                    value={p.type}
                    aria-label={t('editor.variableType', { name: p.name })}
                    onChange={(e) => setParams((ps) => ps.map((x, j) => (j === i ? { ...x, type: e.target.value as QueryParam['type'] } : x)))}
                  >
                    <option value="text">{t('sql.type.text')}</option>
                    <option value="number">{t('sql.type.number')}</option>
                    <option value="date">{t('sql.type.date')}</option>
                  </select>
                  <input
                    className="input"
                    value={values[p.name] ?? ''}
                    type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'}
                    placeholder={p.default ?? ''}
                    aria-label={t('editor.variableValue', { name: p.name })}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  />
                  <input
                    className="input"
                    value={p.default ?? ''}
                    placeholder={t('editor.default')}
                    aria-label={t('editor.variableDefault', { name: p.name })}
                    onChange={(e) => setParams((ps) => ps.map((x, j) => (j === i ? { ...x, default: e.target.value || undefined } : x)))}
                  />
                </div>
              ))}
              <p className="bi-muted">{t('editor.variablesHint')}</p>
            </fieldset>
          )}
        </>
      )}

      <div className="bi-run-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void run({ fresh: true })} disabled={running} aria-busy={running} data-testid="bi-run">
          {running ? t('editor.running') : t('editor.run')}
        </button>
        {result && (
          <div className="bi-viz" role="group" aria-label={t('viz.label')}>
            {(['auto', ...opts] as VizType[]).map((v) => (
              <button key={v} type="button" className={`btn btn-sm ${viz.type === v ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={viz.type === v} onClick={() => setViz({ ...viz, type: v })}>
                {t(`viz.${v}`)}
              </button>
            ))}
          </div>
        )}
        {result && (
          <span className="bi-muted bi-meta">
            {result.cached ? t('editor.cached') : t('editor.ms', { ms: String(result.ms) })}
          </span>
        )}
      </div>

      <section className="bi-result" aria-live="polite" aria-busy={running}>
        {runError ? (
          <p className="ui-error" role="alert" data-testid="bi-run-error">
            {runError}
          </p>
        ) : running && !result ? (
          <div className="ui-loading-stack" role="status">
            <span className="sr-only">{t('common.loading')}</span>
            <span className="ui-skeleton ui-skeleton-block" />
          </div>
        ) : result ? (
          <ResultView result={result} viz={viz} title={name || undefined} />
        ) : (
          <p className="bi-muted bi-empty-result">{t('editor.emptyResult')}</p>
        )}
      </section>

      {(result?.sql || (mode === 'builder' && compiled)) && (
        <details className="bi-sql-shown" open={mode === 'builder'}>
          <summary>{t('editor.showSql')}</summary>
          <pre data-testid="bi-sql-shown">{mode === 'builder' ? compiled : result?.sql}</pre>
          {mode === 'builder' && sqlAllowed && compiled && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setSql(compiled);
                setMode('sql');
              }}
            >
              {t('editor.convertToSql')}
            </button>
          )}
        </details>
      )}

      {id && <SharePanel open={dialog === 'share'} onClose={() => setDialog(null)} kind="question" targetId={id} isAdmin={isAdmin} />}
      <BiDialog open={dialog === 'dashboard'} title={t('editor.addToDashboard')} onClose={() => setDialog(null)}>
        <div className="ui-modal-body">
          {dashboards === null ? (
            <p className="bi-muted" role="status">
              {t('common.loading')}
            </p>
          ) : dashboards.length === 0 ? (
            <p className="bi-muted">
              {t('editor.noDashboards')} <Link href="/app/analytics?new=1">{t('home.newDashboard')}</Link>
            </p>
          ) : (
            <ul className="bi-pick-list" role="list">
              {dashboards.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="btn btn-ghost bi-pick"
                    onClick={async () => {
                      try {
                        await biApi(`/api/bi/dashboards/${d.id}/cards`, { body: { questionId: id } });
                        notifyBiChanged();
                        router.push(`/app/analytics/dashboards/${d.id}`);
                      } catch (err) {
                        setDashError(biErrorText(err, t));
                      }
                    }}
                  >
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {dashError && (
            <p className="ui-error" role="alert">
              {dashError}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-sm" onClick={() => setDialog(null)}>
            {t('common.close')}
          </button>
        </div>
      </BiDialog>
      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('common.deleteTitle', { name: name || t('editor.untitled') })}
        body={t('editor.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (!id) return;
          try {
            await biApi(`/api/bi/questions/${id}`, { method: 'DELETE' });
            notifyBiChanged();
            router.push('/app/analytics');
          } catch (err) {
            setSaveError(biErrorText(err, t));
            setDialog(null);
          }
        }}
      />
    </div>
  );
}

function Builder({
  q,
  set,
  schema,
  columns,
  source,
}: {
  q: BuilderQuery;
  set: (p: Partial<BuilderQuery>) => void;
  schema: SchemaTable[];
  columns: Array<{ ref: string; label: string; type: string }>;
  source: string;
}) {
  const t = useTranslations('bi.builder');
  const tt = useTranslations('bi');
  const joinHints = source === ZS_SOURCE ? (ZS_JOIN_HINTS[q.table] ?? []).filter((h) => schema.some((s) => s.name === h.table) && !q.joins.some((j) => j.table === h.table)) : [];
  // Mismos nombres de salida que lib/bi/builder.ts (columna de tabla unida: tabla_columna).
  const outName = (ref: string) => {
    const parts = ref.split('.');
    return (parts.length > 1 ? `${parts[parts.length - 2]}_${parts[parts.length - 1]}` : ref).replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  };
  const outputs = [...q.breakouts.map((b) => outName(b.column)), ...q.aggregations.map((a) => (a.fn === 'count' ? 'count' : outName(`${a.fn}_${outName(a.column ?? '')}`)))];
  const colSelect = (value: string, onChange: (v: string) => void, label: string, filterType?: (type: string) => boolean) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {columns
        .filter((c) => !filterType || filterType(c.type))
        .map((c) => (
          <option key={c.ref} value={c.ref}>
            {c.label}
          </option>
        ))}
    </select>
  );
  const firstCol = columns[0]?.ref ?? '';
  const remove = <K extends 'joins' | 'filters' | 'aggregations' | 'breakouts' | 'sort'>(key: K, i: number) => set({ [key]: (q[key] as unknown[]).filter((_, j) => j !== i) } as Partial<BuilderQuery>);

  if (!schema.length) return <p className="bi-muted">{tt('sql.noTables')}</p>;

  return (
    <div className="bi-builder" data-testid="bi-builder">
      <section className="bi-step">
        <h3>{t('data')}</h3>
        <select className="input" value={q.table} onChange={(e) => set({ table: e.target.value, joins: [], filters: [], aggregations: [], breakouts: [], sort: [] })} aria-label={t('table')}>
          {schema.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </section>

      <section className="bi-step">
        <h3>{t('join')}</h3>
        {q.joins.map((j, i) => (
          <div key={i} className="bi-row">
            <span>{j.table}</span>
            <span className="bi-muted">
              {j.left} = {j.right}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove('joins', i)} aria-label={t('remove')}>
              ×
            </button>
          </div>
        ))}
        {source === ZS_SOURCE ? (
          joinHints.map((h) => (
            <button key={h.table} type="button" className="btn btn-sm btn-ghost" onClick={() => set({ joins: [...q.joins, { ...h, type: 'left' }] })} disabled={q.joins.length >= 2}>
              + {h.table}
            </button>
          ))
        ) : (
          <ExternalJoin q={q} set={set} schema={schema} />
        )}
      </section>

      <section className="bi-step">
        <h3>{t('filter')}</h3>
        {q.filters.map((f, i) => (
          <div key={i} className="bi-row">
            {colSelect(f.column, (v) => set({ filters: q.filters.map((x, j) => (j === i ? { ...x, column: v } : x)) }), t('column'))}
            <select className="input" value={f.op} onChange={(e) => set({ filters: q.filters.map((x, j) => (j === i ? { ...x, op: e.target.value as (typeof FILTER_OPS)[number] } : x)) })} aria-label={t('operator')}>
              {FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`op.${op}`)}
                </option>
              ))}
            </select>
            {f.op !== 'empty' && f.op !== 'not_empty' && (
              <input
                className="input"
                value={f.value ?? ''}
                type={f.op === 'last_days' ? 'number' : 'text'}
                placeholder={f.op === 'last_days' ? '30' : ''}
                aria-label={t('value')}
                onChange={(e) => set({ filters: q.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
              />
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove('filters', i)} aria-label={t('remove')}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ filters: [...q.filters, { column: firstCol, op: '=', value: '' }] })} disabled={!firstCol}>
          + {t('addFilter')}
        </button>
      </section>

      <section className="bi-step">
        <h3>{t('summarize')}</h3>
        {q.aggregations.map((a, i) => (
          <div key={i} className="bi-row">
            <select className="input" value={a.fn} onChange={(e) => set({ aggregations: q.aggregations.map((x, j) => (j === i ? { ...x, fn: e.target.value as (typeof AGG_FNS)[number], column: x.column ?? firstCol } : x)) })} aria-label={t('metric')}>
              {AGG_FNS.map((fn) => (
                <option key={fn} value={fn}>
                  {t(`fn.${fn}`)}
                </option>
              ))}
            </select>
            {a.fn !== 'count' &&
              colSelect(a.column ?? firstCol, (v) => set({ aggregations: q.aggregations.map((x, j) => (j === i ? { ...x, column: v } : x)) }), t('column'), a.fn === 'distinct' || a.fn === 'min' || a.fn === 'max' ? undefined : (type) => type === 'number')}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove('aggregations', i)} aria-label={t('remove')}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ aggregations: [...q.aggregations, { fn: 'count' }] })}>
          + {t('addMetric')}
        </button>
        <h4>{t('by')}</h4>
        {q.breakouts.map((b, i) => {
          const type = columns.find((c) => c.ref === b.column)?.type;
          return (
            <div key={i} className="bi-row">
              {colSelect(b.column, (v) => set({ breakouts: q.breakouts.map((x, j) => (j === i ? { column: v, bucket: columns.find((c) => c.ref === v)?.type === 'date' ? 'month' : undefined } : x)) }), t('column'))}
              {type === 'date' && (
                <select className="input" value={b.bucket ?? 'month'} onChange={(e) => set({ breakouts: q.breakouts.map((x, j) => (j === i ? { ...x, bucket: e.target.value as (typeof BUCKETS)[number] } : x)) })} aria-label={t('bucket')}>
                  {BUCKETS.map((bk) => (
                    <option key={bk} value={bk}>
                      {t(`bucketOf.${bk}`)}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove('breakouts', i)} aria-label={t('remove')}>
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => set({ breakouts: [...q.breakouts, { column: firstCol, bucket: columns[0]?.type === 'date' ? 'month' : undefined }] })}
          disabled={!firstCol || q.breakouts.length >= 3}
        >
          + {t('addGroup')}
        </button>
      </section>

      <section className="bi-step">
        <h3>{t('sort')}</h3>
        {q.sort.map((s, i) => (
          <div key={i} className="bi-row">
            <select className="input" value={s.column} onChange={(e) => set({ sort: q.sort.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} aria-label={t('column')}>
              {(outputs.length ? outputs : columns.map((c) => c.ref)).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select className="input" value={s.dir} onChange={(e) => set({ sort: q.sort.map((x, j) => (j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x)) })} aria-label={t('direction')}>
              <option value="asc">{t('asc')}</option>
              <option value="desc">{t('desc')}</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove('sort', i)} aria-label={t('remove')}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ sort: [...q.sort, { column: outputs[0] ?? firstCol, dir: 'desc' }] })} disabled={!firstCol}>
          + {t('addSort')}
        </button>
        <label className="bi-inline-field">
          <span className="label">{t('limit')}</span>
          <input className="input bi-limit" type="number" min={1} max={10000} value={q.limit ?? ''} onChange={(e) => set({ limit: e.target.value ? Math.max(1, Math.min(10000, Number(e.target.value))) : undefined })} />
        </label>
      </section>
    </div>
  );
}

function ExternalJoin({ q, set, schema }: { q: BuilderQuery; set: (p: Partial<BuilderQuery>) => void; schema: SchemaTable[] }) {
  const t = useTranslations('bi.builder');
  const [table, setTable] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const base = schema.find((s) => s.name === q.table);
  const other = schema.find((s) => s.name === table);
  if (q.joins.length >= 2) return null;
  return (
    <div className="bi-row">
      <select className="input" value={table} onChange={(e) => setTable(e.target.value)} aria-label={t('joinTable')}>
        <option value="">{t('joinTable')}</option>
        {schema
          .filter((s) => s.name !== q.table && !q.joins.some((j) => j.table === s.name))
          .map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
      </select>
      {other && (
        <>
          <select className="input" value={left} onChange={(e) => setLeft(e.target.value)} aria-label={t('joinLeft')}>
            <option value="">{t('joinLeft')}</option>
            {base?.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <span aria-hidden="true">=</span>
          <select className="input" value={right} onChange={(e) => setRight(e.target.value)} aria-label={t('joinRight')}>
            <option value="">{t('joinRight')}</option>
            {other.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!left || !right}
            onClick={() => {
              set({ joins: [...q.joins, { table, left, right, type: 'left' }] });
              setTable('');
              setLeft('');
              setRight('');
            }}
          >
            {t('addJoin')}
          </button>
        </>
      )}
    </div>
  );
}
