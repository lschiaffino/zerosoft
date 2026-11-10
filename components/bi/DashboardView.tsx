'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { paramNames } from '@/lib/bi/builder';
import type { BiResult, CardMapping, DashFilter, SchemaTable } from '@/lib/bi/types';
import type { CardDto, DashboardDto, ListItem, QuestionDto } from '@/lib/bi/store';
import ResultView from './ResultView';
import SharePanel from './SharePanel';
import SubscriptionsPanel from './SubscriptionsPanel';
import BiDialog from './BiDialog';
import { biApi, biErrorText, notifyBiChanged } from './client';
import { Link } from '@/i18n/navigation';

const REFRESH = [0, 60, 300, 900, 1800, 3600];
const DATE_RANGES = ['last_7', 'last_30', 'last_90', 'last_365'];

/** Posiciones de la grilla a partir del orden: de izquierda a derecha y hacia abajo, 12 columnas. */
function pack(cards: CardDto[]): CardDto[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return cards.map((c) => {
    const w = Math.max(1, Math.min(12, c.w));
    if (x + w > 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const out = { ...c, x, y, w };
    x += w;
    rowH = Math.max(rowH, c.h);
    return out;
  });
}

export default function DashboardView({ initial, isAdmin, startEdit }: { initial: DashboardDto; isAdmin: boolean; startEdit: boolean }) {
  const t = useTranslations('bi');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [dash, setDash] = useState(initial);
  const [cards, setCards] = useState(initial.cards);
  const [filters, setFilters] = useState<DashFilter[]>(initial.filters);
  const [name, setName] = useState(initial.name);
  const [editing, setEditing] = useState(startEdit && initial.canEdit);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of initial.filters) {
      const v = sp.get(`f_${f.id}`);
      if (v) out[f.id] = v;
    }
    return out;
  });
  const [tick, setTick] = useState(0);
  const [refreshSec, setRefreshSec] = useState(initial.refreshSec);
  const [dialog, setDialog] = useState<'share' | 'subs' | 'delete' | 'add' | 'filter' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ListItem[] | null>(null);
  const [full, setFull] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!refreshSec) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    }, refreshSec * 1000);
    return () => clearInterval(id);
  }, [refreshSec]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const setValue = (id: string, v: string) => {
    const next = { ...values, [id]: v };
    if (!v) delete next[id];
    setValues(next);
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(next)) p.set(`f_${k}`, val);
    router.replace(`${pathname}${p.toString() ? `?${p}` : ''}`, { scroll: false });
  };

  const save = async (patch: Record<string, unknown> = {}) => {
    setSaving(true);
    setError(null);
    try {
      const { dashboard } = await biApi<{ dashboard: DashboardDto }>(`/api/bi/dashboards/${dash.id}`, {
        method: 'PATCH',
        body: { name: name.trim() || dash.name, filters, refreshSec, cards: pack(cards), ...patch },
      });
      setDash(dashboard);
      setCards(dashboard.cards);
      setName(dashboard.name);
      notifyBiChanged();
      return true;
    } catch (err) {
      setError(biErrorText(err, t));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateCard = (id: string, patch: Partial<CardDto>) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const moveCard = (id: string, dir: -1 | 1) =>
    setCards((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.current?.requestFullscreen?.().catch(() => setFull((f) => !f));
  };

  return (
    <div ref={wrap} className={`app-page ui-page bi-page bi-dashboard${full ? ' bi-full' : ''}`}>
      <div className="bi-editor-head">
        {editing ? (
          <>
            <label className="sr-only" htmlFor="bi-d-name">
              {t('home.name')}
            </label>
            <input id="bi-d-name" className="bi-title-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </>
        ) : (
          <h1 className="bi-title">{dash.name}</h1>
        )}
        <div className="bi-actions">
          {editing ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setDialog('filter')}>
                {t('dash.addFilter')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setDialog('add');
                  biApi<{ items: ListItem[] }>('/api/bi/items')
                    .then((d) => setQuestions(d.items.filter((i) => i.kind === 'question')))
                    .catch(() => setQuestions([]));
                }}
              >
                {t('dash.addQuestion')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setCards((cs) => [...cs, { id: `new-${Date.now()}`, questionId: null, kind: 'text', text: '', x: 0, y: 0, w: 12, h: 1, mapping: {} }])}>
                {t('dash.addText')}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDialog('delete')}>
                {t('common.delete')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setCards(dash.cards);
                  setFilters(dash.filters);
                  setName(dash.name);
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={saving}
                aria-busy={saving}
                onClick={async () => {
                  if (await save()) setEditing(false);
                }}
              >
                {t('common.save')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setTick((n) => n + 1)}>
                {t('dash.refresh')}
              </button>
              <label className="bi-inline-field">
                <span className="sr-only">{t('dash.autoRefresh')}</span>
                <select
                  className="input"
                  value={refreshSec}
                  aria-label={t('dash.autoRefresh')}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRefreshSec(v);
                    if (dash.canEdit) void biApi(`/api/bi/dashboards/${dash.id}`, { method: 'PATCH', body: { refreshSec: v } }).catch(() => undefined);
                  }}
                >
                  {REFRESH.map((s) => (
                    <option key={s} value={s}>
                      {s === 0 ? t('dash.refreshOff') : s < 3600 ? t('dash.everyMin', { n: String(s / 60) }) : t('dash.everyHour')}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-sm" onClick={fullscreen} aria-pressed={full}>
                {full ? t('dash.exitFullscreen') : t('dash.fullscreen')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setDialog('subs')}>
                {t('subs.button')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setDialog('share')}>
                {t('share.button')}
              </button>
              {dash.canEdit && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
                  {t('dash.edit')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {filters.length > 0 && (
        <div className="bi-filters" role="group" aria-label={t('dash.filters')}>
          {filters.map((f) => (
            <label key={f.id} className="bi-inline-field">
              <span className="label">{f.name}</span>
              {f.type === 'date' ? (
                <select className="input" value={values[f.id] ?? f.default ?? ''} onChange={(e) => setValue(f.id, e.target.value)}>
                  <option value="">{t('dash.anyTime')}</option>
                  {DATE_RANGES.map((r) => (
                    <option key={r} value={r}>
                      {t(`dash.range.${r}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  type={f.type === 'number' ? 'number' : 'text'}
                  defaultValue={values[f.id] ?? ''}
                  placeholder={f.default ?? ''}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setValue(f.id, e.currentTarget.value);
                  }}
                  onBlur={(e) => setValue(f.id, e.currentTarget.value)}
                />
              )}
              {editing && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters((fs) => fs.filter((x) => x.id !== f.id))} aria-label={`${t('common.delete')}: ${f.name}`}>
                  ×
                </button>
              )}
            </label>
          ))}
        </div>
      )}

      {cards.length === 0 ? (
        <EmptyState
          product="analytics"
          title={t('dash.emptyTitle')}
          body={dash.canEdit ? t('dash.emptyBody') : t('dash.emptyBodyReadonly')}
          action={dash.canEdit && !editing ? <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>{t('dash.edit')}</button> : undefined}
        />
      ) : (
        <div className="bi-grid" data-testid="bi-grid">
          {cards.map((c, i) => (
            <div key={c.id} className={`bi-card${editing ? ' editing' : ''}`} style={{ '--w': c.w, '--h': c.h } as CSSProperties}>
              {c.kind === 'text' ? (
                editing ? (
                  <textarea className="input bi-text-card-input" value={c.text} onChange={(e) => updateCard(c.id, { text: e.target.value })} aria-label={t('dash.textCard')} maxLength={4000} />
                ) : (
                  <div className="bi-text-card">{c.text}</div>
                )
              ) : (
                <QuestionCard dashboardId={dash.id} card={c} values={values} tick={tick} editing={editing} filters={filters} onMapping={(m) => updateCard(c.id, { mapping: m })} />
              )}
              {editing && (
                <div className="bi-card-tools" role="group" aria-label={t('dash.cardTools')}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveCard(c.id, -1)} disabled={i === 0} aria-label={t('dash.moveBack')}>
                    ←
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveCard(c.id, 1)} disabled={i === cards.length - 1} aria-label={t('dash.moveForward')}>
                    →
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateCard(c.id, { w: Math.max(3, c.w - 3) })} disabled={c.w <= 3} aria-label={t('dash.narrower')}>
                    ⇤
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateCard(c.id, { w: Math.min(12, c.w + 3) })} disabled={c.w >= 12} aria-label={t('dash.wider')}>
                    ⇥
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateCard(c.id, { h: Math.max(1, c.h - 1) })} disabled={c.h <= 1} aria-label={t('dash.shorter')}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateCard(c.id, { h: Math.min(12, c.h + 1) })} aria-label={t('dash.taller')}>
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCards((cs) => cs.filter((x) => x.id !== c.id))} aria-label={t('dash.removeCard')}>
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <SharePanel open={dialog === 'share'} onClose={() => setDialog(null)} kind="dashboard" targetId={dash.id} isAdmin={isAdmin} />
      <SubscriptionsPanel open={dialog === 'subs'} onClose={() => setDialog(null)} dashboardId={dash.id} />
      <BiDialog open={dialog === 'add'} title={t('dash.addQuestion')} onClose={() => setDialog(null)}>
        <div className="ui-modal-body">
          {questions === null ? (
            <p className="bi-muted" role="status">
              {t('common.loading')}
            </p>
          ) : questions.length === 0 ? (
            <p className="bi-muted">
              {t('dash.noQuestions')} <Link href="/app/analytics/questions/new">{t('home.newQuestion')}</Link>
            </p>
          ) : (
            <ul className="bi-pick-list" role="list">
              {questions.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    className="btn btn-ghost bi-pick"
                    onClick={() => {
                      setCards((cs) => [...cs, { id: `new-${Date.now()}`, questionId: q.id, kind: 'question', text: '', x: 0, y: 0, w: 6, h: 4, mapping: {} }]);
                      setDialog(null);
                    }}
                  >
                    {q.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-sm" onClick={() => setDialog(null)}>
            {t('common.close')}
          </button>
        </div>
      </BiDialog>
      <BiDialog open={dialog === 'filter'} title={t('dash.addFilter')} onClose={() => setDialog(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const fname = String(fd.get('name') ?? '').trim();
            if (!fname) return;
            const base = fname.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'filter';
            let fid = base;
            let n = 2;
            while (filters.some((f) => f.id === fid)) fid = `${base}_${n++}`;
            setFilters((fs) => [...fs, { id: fid, name: fname, type: fd.get('type') as DashFilter['type'] }]);
            setDialog(null);
          }}
        >
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('home.name')}</span>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input className="input" name="name" required maxLength={60} autoFocus />
            </label>
            <label className="ui-field">
              <span className="label">{t('dash.filterType')}</span>
              <select className="input" name="type" defaultValue="text">
                <option value="text">{t('sql.type.text')}</option>
                <option value="number">{t('sql.type.number')}</option>
                <option value="date">{t('sql.type.date')}</option>
              </select>
            </label>
            <p className="bi-muted">{t('dash.filterHint')}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-sm btn-primary">
              {t('common.create')}
            </button>
          </div>
        </form>
      </BiDialog>
      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('common.deleteTitle', { name: dash.name })}
        body={t('dash.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          try {
            await biApi(`/api/bi/dashboards/${dash.id}`, { method: 'DELETE' });
            notifyBiChanged();
            router.push('/app/analytics');
          } catch (err) {
            setError(biErrorText(err, t));
            setDialog(null);
          }
        }}
      />
    </div>
  );
}

function QuestionCard({
  dashboardId,
  card,
  values,
  tick,
  editing,
  filters,
  onMapping,
}: {
  dashboardId: string;
  card: CardDto;
  values: Record<string, string>;
  tick: number;
  editing: boolean;
  filters: DashFilter[];
  onMapping: (m: CardMapping) => void;
}) {
  const t = useTranslations('bi');
  const [question, setQuestion] = useState<QuestionDto | null>(null);
  const [result, setResult] = useState<BiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [schema, setSchema] = useState<SchemaTable[]>([]);
  const saved = !card.id.startsWith('new-');
  const lastTick = useRef(tick);

  const load = useCallback(
    async (fresh: boolean) => {
      if (!card.questionId) return;
      setLoading(true);
      setError(null);
      try {
        const q = question ?? (await biApi<{ question: QuestionDto }>(`/api/bi/questions/${card.questionId}`)).question;
        setQuestion(q);
        const body = saved ? { values, fresh, dashboardId, cardId: card.id } : { values: {}, fresh };
        const d = await biApi<{ result: BiResult }>(`/api/bi/questions/${card.questionId}/run`, { body });
        setResult(d.result);
      } catch (err) {
        setError(biErrorText(err, t));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card.questionId, card.id, dashboardId, JSON.stringify(values), saved],
  );

  useEffect(() => {
    const fresh = tick !== lastTick.current;
    lastTick.current = tick;
    void load(fresh);
  }, [load, tick]);

  useEffect(() => {
    if (!editing || !question || question.query.kind !== 'builder' || schema.length) return;
    biApi<{ tables: SchemaTable[] }>(`/api/bi/schema?source=${encodeURIComponent(question.source)}`)
      .then((d) => setSchema(d.tables))
      .catch(() => setSchema([]));
  }, [editing, question, schema.length]);

  const targets: Array<{ value: string; label: string }> = question
    ? question.query.kind === 'sql'
      ? paramNames(question.query.sql).map((n) => ({ value: `param:${n}`, label: `{{${n}}}` }))
      : (() => {
          const q = question.query;
          const tables = [q.table, ...q.joins.map((j) => j.table)];
          return tables.flatMap((tn, i) => (schema.find((s) => s.name === tn)?.columns ?? []).map((c) => ({ value: `column:${i === 0 ? c.name : `${tn}.${c.name}`}`, label: i === 0 ? c.name : `${tn} · ${c.name}` })));
        })()
    : [];

  return (
    <article className="bi-card-body" aria-busy={loading}>
      <header className="bi-card-head">
        {question ? (
          <Link href={`/app/analytics/questions/${question.id}`} className="bi-card-title">
            {question.name}
          </Link>
        ) : (
          <span className="bi-card-title">{loading ? '' : t('dash.missingQuestion')}</span>
        )}
        {result?.cached && <span className="bi-muted bi-card-meta">{t('editor.cached')}</span>}
      </header>
      {editing && filters.length > 0 && question && (
        <div className="bi-mapping">
          {filters.map((f) => {
            const m = card.mapping[f.id];
            const cur = m?.param ? `param:${m.param}` : m?.column ? `column:${m.column}` : '';
            return (
              <label key={f.id} className="bi-inline-field">
                <span className="label">{f.name}</span>
                <select
                  className="input"
                  value={cur}
                  onChange={(e) => {
                    const v = e.target.value;
                    const next = { ...card.mapping };
                    if (!v) delete next[f.id];
                    else if (v.startsWith('param:')) next[f.id] = { param: v.slice(6) };
                    else next[f.id] = { column: v.slice(7) };
                    onMapping(next);
                  }}
                >
                  <option value="">{t('dash.notConnected')}</option>
                  {targets.map((tg) => (
                    <option key={tg.value} value={tg.value}>
                      {tg.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
      <div className="bi-card-content">
        {error ? (
          <p className="ui-error" role="alert">
            {error}
          </p>
        ) : loading && !result ? (
          <span className="ui-skeleton ui-skeleton-block" role="status" aria-label={t('common.loading')} />
        ) : result && question ? (
          <ResultView result={result} viz={question.viz} compact title={question.name} />
        ) : null}
      </div>
    </article>
  );
}
