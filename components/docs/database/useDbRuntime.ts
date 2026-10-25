'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { DbAction, DbFile, DbProperty, DbRow, DbValue, DocsDatabase } from '@/lib/docs-types';
import { findRow, formatValue, newDbId, rowTitle, setCell } from '@/lib/docs-database';
import { computeDatabase, dbKey, relatedSources, relationTarget, rowTitlesFor, type DbComputeEnv } from '@/lib/docs-db-compute';
import { applyButtonActions, applyDbOps, remoteActions, runAutomations, type DbOp } from '@/lib/docs-db-ops';
import { docsFileHref } from '@/lib/docs-files';
import type { DbRefs } from './DbValueView';
import type { DbCellExtras } from './DbCellEditor';
import { sendOps, useSources, type RemoteDb } from './dbSources';

/** Dónde vive una base: página y bloque (pageId null: una nota, sin bases de otras páginas). */
export interface DbSource {
  pageId: string | null;
  blockId: string;
}

export interface DbRuntimeOptions {
  db: DocsDatabase;
  source: DbSource;
  /** Página abierta en el editor (las bases de esta página se editan localmente). */
  hostPageId: string | null;
  /** Guarda la base (la de `source`); corre las automatizaciones antes de guardar. */
  commit: (next: DocsDatabase) => void;
  /** Cambio sobre otra base de la página abierta. */
  updateDatabase?: (blockId: string, fn: (db: DocsDatabase) => DocsDatabase) => void;
  people: Record<string, string>;
  locale: string;
  labels: { untitled: string; error: string; openMap: string };
}

export interface DbRuntime {
  /** Base con fórmulas, espejos y rollups resueltos (solo para mostrar). */
  shown: DocsDatabase;
  env: DbComputeEnv;
  sources: Record<string, RemoteDb>;
  refs: DbRefs;
  extras: DbCellExtras;
  /** Editar una celda (las relaciones espejo escriben en la otra base). */
  setValue: (rowId: string, propId: string, value: DbValue) => void;
  /** Base relacionada de una propiedad relation (null: cargando o sin acceso). */
  targetOf: (prop: DbProperty) => { db: DocsDatabase | null; status: RemoteDb['status']; title: string };
  /** Escribe operaciones en otra base (esta, otra de la página o de otra página). */
  writeTo: (target: { page_id: string; block_id: string }, ops: DbOp[]) => Promise<boolean>;
  /** Mensaje de la última acción (botón, error de escritura). */
  notice: { kind: 'ok' | 'error'; text: string } | null;
  setNotice: (n: { kind: 'ok' | 'error'; text: string } | null) => void;
}

/** Corre las automatizaciones sobre un cambio local antes de guardarlo (lo que el servidor va a hacer igual). */
export function withAutomations(prev: DocsDatabase, next: DocsDatabase): DocsDatabase {
  if (!next.automations?.length) return next;
  return runAutomations(prev, next).db;
}

/**
 * Todo lo que necesita una base para relaciones, rollups, fórmulas,
 * archivos y botones: carga las bases relacionadas, calcula la base que se
 * muestra y arma las funciones que usan las celdas.
 */
export function useDbRuntime(o: DbRuntimeOptions, messages: { buttonDone: string; buttonError: string; writeError: string }): DbRuntime {
  const { db, source, hostPageId, commit, updateDatabase, people, locale, labels } = o;
  const needed = useMemo(() => (source.pageId ? relatedSources(db, { pageId: source.pageId, blockId: source.blockId }) : []), [db, source.pageId, source.blockId]);
  const sources = useSources(hostPageId, needed);
  const foreign = useMemo(() => {
    const out: Record<string, DocsDatabase | null> = {};
    for (const [k, v] of Object.entries(sources)) out[k] = v.db;
    return out;
  }, [sources]);
  const env = useMemo<DbComputeEnv>(() => ({ pageId: source.pageId, blockId: source.blockId, foreign, people, locale }), [source.pageId, source.blockId, foreign, people, locale]);
  const shown = useMemo(() => computeDatabase(db, env), [db, env]);
  const titles = useMemo(() => rowTitlesFor(db, env), [db, env]);
  const [notice, setNotice] = useState<DbRuntime['notice']>(null);
  const [busyButton, setBusyButton] = useState<string | null>(null);
  const latest = useRef({ db, commit, shown });
  latest.current = { db, commit, shown };

  const writeTo = useCallback(
    async (target: { page_id: string; block_id: string }, ops: DbOp[]): Promise<boolean> => {
      if (!ops.length) return true;
      if (source.pageId && target.page_id === source.pageId && target.block_id === source.blockId) {
        const cur = latest.current.db;
        latest.current.commit(applyDbOps(cur, ops));
        return true;
      }
      if (hostPageId && target.page_id === hostPageId && updateDatabase) {
        updateDatabase(target.block_id, (d) => withAutomations(d, applyDbOps(d, ops)));
        return true;
      }
      const res = await sendOps(target.page_id, target.block_id, ops);
      if (!res.ok) setNotice({ kind: 'error', text: messages.writeError });
      return res.ok;
    },
    [source.pageId, source.blockId, hostPageId, updateDatabase, messages.writeError],
  );

  const targetOf = useCallback(
    (prop: DbProperty) => {
      const r = prop.relation;
      if (!r) return { db: null, status: 'error' as const, title: '' };
      const self = relationTarget(db, prop, env);
      if (self === db) return { db, status: 'ready' as const, title: db.title ?? '' };
      const s = sources[dbKey(r.page_id, r.block_id)];
      return { db: s?.db ?? null, status: s?.status ?? 'loading', title: s?.db?.title || s?.page?.title || '' };
    },
    [db, env, sources],
  );

  const setValue = useCallback(
    (rowId: string, propId: string, value: DbValue) => {
      const cur = latest.current.db;
      const prop = cur.properties.find((p) => p.id === propId);
      if (prop?.type === 'relation' && prop.relation?.mirror_of) {
        // Espejo: se escribe en la relación original de la otra base.
        const before = (latest.current.shown.rows.find((r) => r.id === rowId)?.values[propId] as string[] | undefined) ?? [];
        const after = Array.isArray(value) ? value : [];
        const ops: DbOp[] = [];
        for (const id of after) if (!before.includes(id)) ops.push({ op: 'relation', row: id, prop: prop.relation.mirror_of, add: [rowId] });
        for (const id of before) if (!after.includes(id)) ops.push({ op: 'relation', row: id, prop: prop.relation.mirror_of, remove: [rowId] });
        void writeTo({ page_id: prop.relation.page_id, block_id: prop.relation.block_id }, ops);
        return;
      }
      latest.current.commit(setCell(cur, rowId, propId, value));
    },
    [writeTo],
  );

  const runButton = useCallback(
    async (prop: DbProperty, row: DbRow) => {
      const actions: DbAction[] = prop.button?.actions ?? [];
      const cur = latest.current.db;
      const local = applyButtonActions(cur, row.id, actions);
      if (local !== cur) latest.current.commit(local);
      for (const a of actions) {
        if (a.type !== 'open_url') continue;
        if (a.url.startsWith('/')) window.location.assign(a.url);
        else window.open(a.url, '_blank', 'noopener,noreferrer');
      }
      const remote = remoteActions(actions);
      if (!remote.length || !source.pageId) {
        if (actions.length) setNotice({ kind: 'ok', text: messages.buttonDone });
        return;
      }
      setBusyButton(`${prop.id}:${row.id}`);
      const shownRow = latest.current.shown.rows.find((r) => r.id === row.id) ?? row;
      const values: Record<string, string> = {};
      for (const p of latest.current.shown.properties) {
        if (p.type === 'title' || p.type === 'button') continue;
        values[p.name.slice(0, 200)] = formatValue(p, shownRow, { people, locale, rowTitles: titles }).slice(0, 2000);
      }
      try {
        const res = await fetch(`/api/docs/databases/${encodeURIComponent(source.pageId)}/${encodeURIComponent(source.blockId)}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ row_id: row.id, prop_id: prop.id, actions: remote, row: { title: rowTitle(cur, row).slice(0, 2000), values } }),
        });
        const data = (await res.json().catch(() => ({}))) as { results?: Array<{ ok: boolean }> };
        const ok = res.ok && (data.results ?? []).every((r) => r.ok);
        setNotice({ kind: ok ? 'ok' : 'error', text: ok ? messages.buttonDone : messages.buttonError });
      } catch {
        setNotice({ kind: 'error', text: messages.buttonError });
      } finally {
        setBusyButton(null);
      }
    },
    [source.pageId, source.blockId, people, locale, titles, messages.buttonDone, messages.buttonError],
  );

  const fileHref = useCallback(
    (fileId: string) => (source.pageId ? docsFileHref(source.pageId, fileId) : null),
    [source.pageId],
  );

  const refs = useMemo<DbRefs>(
    () => ({ titles, fileHref, onButton: (p, r) => void runButton(p, r), busyButton, labels }),
    [titles, fileHref, runButton, busyButton, labels],
  );

  const extras = useMemo<DbCellExtras>(
    () => ({
      relation: (prop) => {
        const t = targetOf(prop);
        const tdb = t.db;
        const choices = tdb ? tdb.rows.map((r) => ({ id: r.id, title: rowTitle(tdb, r) })) : [];
        const target = prop.relation;
        return {
          choices,
          status: t.status,
          onCreate: target
            ? async (title: string) => {
                const id = newDbId();
                const ok = await writeTo({ page_id: target.page_id, block_id: target.block_id }, [{ op: 'add_row', id, title }]);
                return ok ? id : null;
              }
            : undefined,
        };
      },
      files: {
        href: fileHref,
        upload: source.pageId
          ? async (file: File): Promise<DbFile> => {
              const form = new FormData();
              form.append('file', file);
              const res = await fetch(`/api/docs/pages/${encodeURIComponent(source.pageId!)}/files`, { method: 'POST', body: form });
              const data = (await res.json().catch(() => ({}))) as { url?: string; name?: string; size?: number; mime?: string; error?: string };
              if (!res.ok || !data.url) throw new Error(data.error ?? 'upload_failed');
              return { id: newDbId(), url: data.url, name: data.name ?? file.name, size: data.size, mime: data.mime };
            }
          : null,
      },
      onFiles: (rowId, propId, files) => {
        const cur = latest.current.db;
        const row = findRow(cur, rowId);
        if (!row) return;
        const next = { ...(row.files ?? {}) };
        if (files.length) next[propId] = files;
        else delete next[propId];
        const now = new Date().toISOString();
        const updated: DocsDatabase = {
          ...cur,
          rows: cur.rows.map((r) => {
            if (r.id !== rowId) return r;
            const out: DbRow = { ...r, updated_at: now };
            if (Object.keys(next).length) out.files = next;
            else delete out.files;
            return out;
          }),
        };
        latest.current.commit(updated);
      },
    }),
    [targetOf, writeTo, fileHref, source.pageId],
  );

  return { shown, env, sources, refs, extras, setValue, targetOf, writeTo, notice, setNotice };
}
