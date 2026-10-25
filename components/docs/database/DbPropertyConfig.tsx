'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbAiMode, DbProperty, DbRollupFn, DocsDatabase, DocsMentionableUser } from '@/lib/docs-types';
import { newDbId, updateProperty } from '@/lib/docs-database';
import { FORMULA_FUNCTIONS } from '@/lib/docs-formula';
import { previewFormula, rollupFns, type DbComputeEnv } from '@/lib/docs-db-compute';
import type { DbOp } from '@/lib/docs-db-ops';
import { useWorkspaceDatabases } from './dbSources';
import type { DbRuntime, DbSource } from './useDbRuntime';
import { DbActionsEditor } from './DbActions';

type Commit = (next: DocsDatabase) => void;

const FORMULA_ERRORS = new Set([
  'cycle',
  'unknown_property',
  'too_long',
  'bad_number',
  'unterminated_string',
  'unexpected',
  'expected',
  'unexpected_token',
  'expected_function',
  'prop_needs_name',
  'unknown_function',
  'unknown_name',
  'parse_error',
  'bad_unit',
  'too_complex',
  'date_math',
  'bad_operator',
  'if_args',
]);

/** Error de fórmula legible ("unknown_property:Precio" → "No hay una propiedad «Precio»"). */
export function formulaErrorText(t: (key: string, values?: Record<string, string>) => string, code: string): string {
  const at = code.indexOf(':');
  const key = at === -1 ? code : code.slice(0, at);
  const arg = at === -1 ? '' : code.slice(at + 1);
  return FORMULA_ERRORS.has(key) ? t(`formula.errors.${key}`, { arg }) : t('formula.errors.generic', { arg: code });
}

/** Editor de una fórmula: texto, propiedades y funciones para insertar, vista previa con la primera fila. */
export function DbFormulaEditor({ db, prop, env, commit }: { db: DocsDatabase; prop: DbProperty; env: DbComputeEnv; commit: Commit }) {
  const t = useTranslations('docs.database');
  const [text, setText] = useState(prop.formula ?? '');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const preview = useMemo(() => previewFormula(db, text, env, prop.id), [db, prop.id, text, env]);
  const insert = (snippet: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const at = start + snippet.length;
      el?.setSelectionRange(at, at);
    });
  };
  const [blocked, setBlocked] = useState(false);
  const invalid = Boolean(preview.error) && text.trim() !== '';
  // Una fórmula con error no se guarda (queda la anterior) y se avisa.
  const save = () => {
    if (invalid) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    if ((prop.formula ?? '') !== text) commit(updateProperty(db, prop.id, { formula: text }));
  };
  const props = db.properties.filter((p) => p.id !== prop.id && p.type !== 'button');
  return (
    <div className="docs-db-formula" data-testid="docs-db-formula">
      <p className="docs-db-menu-label">{t('formula.title')}</p>
      <textarea
        ref={ref}
        className="docs-db-field docs-db-formula-input mono"
        data-autofocus
        aria-label={t('formula.title')}
        placeholder='prop("Price") * prop("Quantity")'
        value={text}
        rows={3}
        maxLength={4000}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          setBlocked(false);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <p className={`docs-db-formula-preview${invalid ? ' is-error' : ''}`} role="status" aria-live="polite" data-testid="docs-db-formula-status">
        {invalid ? t('formula.error', { detail: formulaErrorText(t, preview.error!) }) : preview.value ? t('formula.preview', { value: preview.value }) : t('formula.hint')}
      </p>
      {blocked && invalid && (
        <p className="docs-db-error" role="alert" data-testid="docs-db-formula-blocked">
          {t('formula.cantSave')}
        </p>
      )}
      <div className="docs-db-formula-help">
        <div>
          <p className="docs-db-menu-label">{t('properties')}</p>
          <div className="docs-db-formula-chips">
            {props.map((p) => (
              <button key={p.id} type="button" className="docs-db-formula-chip" onClick={() => insert(`prop("${p.name}")`)}>
                {p.name || t('untitledProperty')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="docs-db-menu-label">{t('formula.functions')}</p>
          <div className="docs-db-formula-chips">
            {FORMULA_FUNCTIONS.map((f) => (
              <button key={f.name} type="button" className="docs-db-formula-chip mono" title={f.sig} onClick={() => insert(`${f.name}(`)}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={save}>
        {t('formula.save')}
      </button>
    </div>
  );
}

/**
 * Configurar una relación: a qué base (esta, otra de la página o de otra
 * página del workspace), límite de una fila y si se muestra también en la
 * otra base (dos vías: crea la propiedad espejo allá).
 */
export function DbRelationConfig({
  db,
  prop,
  source,
  runtime,
  commit,
}: {
  db: DocsDatabase;
  prop: DbProperty;
  source: DbSource;
  runtime: DbRuntime;
  commit: Commit;
}) {
  const t = useTranslations('docs.database');
  const dbs = useWorkspaceDatabases(!prop.relation?.mirror_of);
  const [busy, setBusy] = useState(false);
  const r = prop.relation;
  const target = r ? runtime.targetOf(prop) : null;
  const selfKey = source.pageId ? `${source.pageId}:${source.blockId}` : '';
  const key = r ? `${r.page_id}:${r.block_id}` : '';

  if (r?.mirror_of) {
    return (
      <div className="docs-db-config">
        <p className="docs-db-hint">{t('relation.mirrorOf', { name: target?.title || t('untitledDatabase') })}</p>
      </div>
    );
  }

  const pick = (value: string) => {
    const [page_id, block_id] = value.split(':');
    if (!page_id || !block_id) return;
    commit(updateProperty(db, prop.id, { relation: { page_id, block_id, ...(r?.limit ? { limit: 1 as const } : {}) } }));
  };

  /** Dos vías: crea (o borra) la propiedad espejo en la otra base. */
  const toggleTwoWay = async (on: boolean) => {
    if (!r || busy) return;
    setBusy(true);
    const tgt = { page_id: r.page_id, block_id: r.block_id };
    if (on) {
      const mirror: DbProperty = {
        id: newDbId(),
        name: (db.title || t('relation.related')).slice(0, 200),
        type: 'relation',
        relation: { page_id: source.pageId!, block_id: source.blockId, mirror_of: prop.id },
      };
      const isSelf = r.page_id === source.pageId && r.block_id === source.blockId;
      if (isSelf) {
        const withSync = updateProperty(db, prop.id, { relation: { ...r, synced_prop: mirror.id } });
        commit({ ...withSync, properties: [...withSync.properties, mirror] });
      } else {
        const linked = { ...r, synced_prop: mirror.id };
        if (runtime.writeLinked && source.pageId) {
          // Las dos mitades en una sola request: el servidor crea el espejo allá y
          // marca la relación acá, aunque la pestaña se cierre enseguida.
          const self = db.properties.find((p) => p.id === prop.id);
          const ok = await runtime.writeLinked(
            tgt,
            [{ op: 'add_property', property: mirror }],
            { page_id: source.pageId, block_id: source.blockId, ops: self ? [{ op: 'update_property', property: { ...self, relation: linked } }] : [] },
            [{ op: 'remove_property', prop: mirror.id }],
          );
          if (ok) commit(updateProperty(db, prop.id, { relation: linked }));
        } else {
          const ok = await runtime.writeTo(tgt, [{ op: 'add_property', property: mirror }]);
          if (ok) commit(updateProperty(db, prop.id, { relation: linked }));
        }
      }
    } else if (r.synced_prop) {
      const ops: DbOp[] = [{ op: 'remove_property', prop: r.synced_prop }];
      const isSelf = r.page_id === source.pageId && r.block_id === source.blockId;
      const { synced_prop: _s, ...rest } = r;
      void _s;
      if (isSelf) commit({ ...db, properties: db.properties.filter((p) => p.id !== r.synced_prop).map((p) => (p.id === prop.id ? { ...p, relation: rest } : p)) });
      else if (await runtime.writeTo(tgt, ops)) commit(updateProperty(db, prop.id, { relation: rest }));
    }
    setBusy(false);
  };

  return (
    <div className="docs-db-config" data-testid="docs-db-relation-config">
      <label className="docs-db-row-field">
        <span>{t('relation.database')}</span>
        <select className="docs-db-select" data-autofocus value={key} onChange={(e) => pick(e.target.value)} disabled={Boolean(r?.synced_prop)}>
          <option value="">{dbs.status === 'loading' ? t('relation.loading') : t('relation.pickDatabase')}</option>
          {selfKey && <option value={selfKey}>{t('relation.thisDatabase', { name: db.title || t('untitledDatabase') })}</option>}
          {dbs.rows
            .filter((d) => `${d.page_id}:${d.block_id}` !== selfKey)
            .map((d) => (
              <option key={`${d.page_id}:${d.block_id}`} value={`${d.page_id}:${d.block_id}`}>
                {d.title || t('untitledDatabase')} · {d.page_title || t('untitledPage')}
              </option>
            ))}
          {key && key !== selfKey && !dbs.rows.some((d) => `${d.page_id}:${d.block_id}` === key) && <option value={key}>{target?.title || t('untitledDatabase')}</option>}
        </select>
      </label>
      {dbs.status === 'error' && <p className="docs-db-error">{t('relation.loadError')}</p>}
      {r && (
        <>
          <label className="docs-db-row-field">
            <span>{t('relation.limit')}</span>
            <select
              className="docs-db-select"
              value={r.limit === 1 ? '1' : ''}
              onChange={(e) => {
                const next = { ...r } as typeof r;
                if (e.target.value === '1') next.limit = 1;
                else delete next.limit;
                commit(updateProperty(db, prop.id, { relation: next }));
              }}
            >
              <option value="">{t('relation.noLimit')}</option>
              <option value="1">{t('relation.onePage')}</option>
            </select>
          </label>
          <label className="docs-db-propitem">
            <input type="checkbox" checked={Boolean(r.synced_prop)} disabled={busy || !source.pageId} onChange={(e) => void toggleTwoWay(e.target.checked)} />
            <span>{t('relation.twoWay', { name: target?.title || t('untitledDatabase') })}</span>
          </label>
          {target?.status === 'error' && <p className="docs-db-error">{t('relation.loadError')}</p>}
        </>
      )}
    </div>
  );
}

const ROLLUP_LABEL: Record<DbRollupFn, string> = {
  show_original: 'showOriginal',
  show_unique: 'showUnique',
  count_all: 'countAll',
  count_values: 'countValues',
  count_unique: 'countUnique',
  count_empty: 'countEmpty',
  count_not_empty: 'countNotEmpty',
  percent_empty: 'percentEmpty',
  percent_not_empty: 'percentNotEmpty',
  sum: 'sum',
  average: 'average',
  median: 'median',
  min: 'min',
  max: 'max',
  range: 'range',
  checked: 'checked',
  unchecked: 'unchecked',
  percent_checked: 'percentChecked',
  earliest: 'earliest',
  latest: 'latest',
  date_range: 'dateRange',
};

/** Configurar un rollup: relación, propiedad de la otra base y cálculo. */
export function DbRollupConfig({ db, prop, runtime, commit }: { db: DocsDatabase; prop: DbProperty; runtime: DbRuntime; commit: Commit }) {
  const t = useTranslations('docs.database');
  const relations = db.properties.filter((p) => p.type === 'relation' && p.relation);
  const cfg = prop.rollup;
  const rel = relations.find((p) => p.id === cfg?.relation);
  const target = rel ? runtime.targetOf(rel) : null;
  const tprops = target?.db?.properties.filter((p) => p.type !== 'button') ?? [];
  const tprop = tprops.find((p) => p.id === cfg?.property);
  const fns = rollupFns(tprop);
  const set = (patch: Partial<NonNullable<DbProperty['rollup']>>) => {
    const next = { relation: cfg?.relation ?? '', property: cfg?.property ?? '', fn: cfg?.fn ?? 'show_original', ...patch } as NonNullable<DbProperty['rollup']>;
    commit(updateProperty(db, prop.id, { rollup: next }));
  };
  if (!relations.length) return <p className="docs-db-hint">{t('rollup.needsRelation')}</p>;
  return (
    <div className="docs-db-config" data-testid="docs-db-rollup-config">
      <label className="docs-db-row-field">
        <span>{t('rollup.relation')}</span>
        <select className="docs-db-select" data-autofocus value={cfg?.relation ?? ''} onChange={(e) => set({ relation: e.target.value, property: '' })}>
          <option value="">{t('pickProperty')}</option>
          {relations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || t('untitledProperty')}
            </option>
          ))}
        </select>
      </label>
      {rel && (
        <label className="docs-db-row-field">
          <span>{t('rollup.property')}</span>
          <select className="docs-db-select" value={cfg?.property ?? ''} onChange={(e) => set({ property: e.target.value })} disabled={!target?.db}>
            <option value="">{target?.status === 'loading' ? t('relation.loading') : t('pickProperty')}</option>
            {tprops.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || t('untitledProperty')}
              </option>
            ))}
          </select>
        </label>
      )}
      {tprop && (
        <label className="docs-db-row-field">
          <span>{t('rollup.calculate')}</span>
          <select className="docs-db-select" value={fns.includes(cfg?.fn ?? 'show_original') ? cfg?.fn : 'show_original'} onChange={(e) => set({ fn: e.target.value as DbRollupFn })}>
            {fns.map((f) => (
              <option key={f} value={f}>
                {t(`rollup.fns.${ROLLUP_LABEL[f]}`)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Prefijo del ID único ("TASK" → TASK-12). */
export function DbUniqueIdConfig({ db, prop, commit }: { db: DocsDatabase; prop: DbProperty; commit: Commit }) {
  const t = useTranslations('docs.database');
  return (
    <label className="docs-db-row-field">
      <span>{t('uniqueId.prefix')}</span>
      <input
        className="docs-db-field docs-db-field-sm mono"
        value={prop.prefix ?? ''}
        maxLength={20}
        placeholder="TASK"
        aria-label={t('uniqueId.prefix')}
        onChange={(e) => commit(updateProperty(db, prop.id, { prefix: e.target.value.replace(/[^\p{L}\p{N}_]/gu, '').toUpperCase() }))}
      />
    </label>
  );
}

/** Botón: texto y acciones. */
export function DbButtonConfig({ db, prop, members, commit }: { db: DocsDatabase; prop: DbProperty; members: DocsMentionableUser[]; commit: Commit }) {
  const t = useTranslations('docs.database');
  const cfg = prop.button ?? { label: prop.name, actions: [] };
  return (
    <div className="docs-db-config" data-testid="docs-db-button-config">
      <label className="docs-db-row-field">
        <span>{t('button.label')}</span>
        <input className="docs-db-field docs-db-field-sm" value={cfg.label} maxLength={200} onChange={(e) => commit(updateProperty(db, prop.id, { button: { ...cfg, label: e.target.value } }))} />
      </label>
      <DbActionsEditor db={db} actions={cfg.actions} members={members} forButton onChange={(actions) => commit(updateProperty(db, prop.id, { button: { ...cfg, actions } }))} />
    </div>
  );
}

const AI_MODES: DbAiMode[] = ['summary', 'extract', 'translate', 'classify', 'custom'];

/** Autocompletar con IA (text, select, multi-select): qué hace, cuándo corre y "Rellenar todo". */
export function DbAiConfig({
  db,
  prop,
  commit,
  onFill,
  filling,
}: {
  db: DocsDatabase;
  prop: DbProperty;
  commit: Commit;
  onFill: (onlyEmpty: boolean) => void;
  filling: boolean;
}) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const ai = prop.ai;
  const modes = AI_MODES.filter((m) => (prop.type === 'text' ? m !== 'classify' : m === 'classify'));
  const set = (patch: Partial<NonNullable<DbProperty['ai']>> | null) => {
    if (patch === null) {
      commit(updateProperty(db, prop.id, { ai: undefined }));
      return;
    }
    const base = ai ?? { mode: modes[0] };
    commit(updateProperty(db, prop.id, { ai: { ...base, ...patch } }));
  };
  return (
    <div className="docs-db-config docs-db-ai" data-testid="docs-db-ai-config">
      <p className="docs-db-menu-label">{t('ai.title')}</p>
      <label className="docs-db-row-field">
        <span>{t('ai.mode')}</span>
        <select className="docs-db-select" value={ai?.mode ?? ''} onChange={(e) => set(e.target.value ? { mode: e.target.value as DbAiMode, ...(e.target.value === 'translate' && !ai?.language ? { language: locale } : {}) } : null)}>
          <option value="">{t('ai.off')}</option>
          {modes.map((m) => (
            <option key={m} value={m}>
              {t(`ai.modes.${m}`)}
            </option>
          ))}
        </select>
      </label>
      {ai && (ai.mode === 'extract' || ai.mode === 'custom' || ai.mode === 'classify') && (
        <input
          className="docs-db-field"
          aria-label={t('ai.prompt')}
          placeholder={ai.mode === 'extract' ? t('ai.extractPlaceholder') : ai.mode === 'classify' ? t('ai.classifyPlaceholder') : t('ai.customPlaceholder')}
          value={ai.prompt ?? ''}
          maxLength={2000}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      )}
      {ai?.mode === 'translate' && (
        <label className="docs-db-row-field">
          <span>{t('ai.language')}</span>
          <select className="docs-db-select" value={ai.language ?? 'en'} onChange={(e) => set({ language: e.target.value })}>
            {['en', 'es', 'pt', 'fr', 'de', 'it', 'ja', 'zh'].map((l) => (
              <option key={l} value={l}>
                {new Intl.DisplayNames([locale], { type: 'language' }).of(l) ?? l}
              </option>
            ))}
          </select>
        </label>
      )}
      {ai && (
        <>
          <label className="docs-db-propitem">
            <input type="checkbox" checked={Boolean(ai.auto)} onChange={(e) => set({ auto: e.target.checked })} />
            <span>{t('ai.auto')}</span>
          </label>
          <div className="docs-db-inline">
            <button type="button" className="btn btn-sm" disabled={filling} onClick={() => onFill(false)} data-testid="docs-db-ai-fill">
              {filling ? t('ai.filling') : t('ai.fillAll')}
            </button>
            <button type="button" className="docs-db-link-btn" disabled={filling} onClick={() => onFill(true)}>
              {t('ai.fillEmpty')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
