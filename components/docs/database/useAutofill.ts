'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DbRow, DbValue, DocsDatabase } from '@/lib/docs-types';
import { formatValue, isEmptyValue, rowTitle, setCell } from '@/lib/docs-database';
import type { DbSource } from './useDbRuntime';

const BATCH = 25;

function plain(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Lo que ve la IA de una fila: título, las otras propiedades y el cuerpo en texto. */
export function rowForAi(shown: DocsDatabase, row: DbRow, skipProp: string, ctx: { people: Record<string, string>; rowTitles?: Record<string, string> }) {
  const lines: string[] = [];
  for (const p of shown.properties) {
    if (p.type === 'title' || p.type === 'button' || p.id === skipProp) continue;
    const v = formatValue(p, row, ctx);
    if (v) lines.push(`${p.name}: ${v}`);
  }
  return {
    id: row.id,
    title: rowTitle(shown, row).slice(0, 2000),
    properties: lines.join('\n').slice(0, 8000),
    body: (row.body ?? []).map((b) => plain(b.content ?? '')).filter(Boolean).join('\n').slice(0, 20000),
  };
}

/** Firma de lo que mira la IA en una fila (sin las propiedades que rellena). */
function contentKey(db: DocsDatabase, row: DbRow, aiProps: Set<string>): string {
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.values)) if (!aiProps.has(k)) values[k] = v;
  return JSON.stringify([values, row.body ?? null, rowTitle(db, row)]);
}

export type AutofillError = 'ai_disabled' | 'quota_exceeded' | 'rate_limited' | 'ai_failed';

/**
 * Autocompletar con IA: rellena una propiedad en las filas pedidas (de a 25
 * por pedido) y, para las propiedades con "al editar", vuelve a correr sobre
 * las filas que cambiaron (2,5 s después del último cambio).
 */
export function useAutofill(o: {
  db: DocsDatabase;
  shown: DocsDatabase;
  source: DbSource;
  commit: (next: DocsDatabase) => void;
  people: Record<string, string>;
  rowTitles: Record<string, string>;
  editable: boolean;
  onError: (code: AutofillError) => void;
}) {
  const [filling, setFilling] = useState<string | null>(null);
  const latest = useRef(o);
  latest.current = o;

  const fill = useCallback(async (propId: string, rowIds: string[] | null, onlyEmpty = false): Promise<boolean> => {
    const { db, shown, source, people, rowTitles } = latest.current;
    const prop = db.properties.find((p) => p.id === propId);
    if (!prop?.ai || !source.pageId) return false;
    let rows = shown.rows.filter((r) => !rowIds || rowIds.includes(r.id));
    if (onlyEmpty) rows = rows.filter((r) => isEmptyValue(r.values[propId]));
    rows = rows.filter((r) => rowTitle(shown, r).trim() || r.body?.length);
    if (!rows.length) return true;
    setFilling(propId);
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const res = await fetch(`/api/docs/pages/${encodeURIComponent(source.pageId)}/autofill`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            block_id: source.blockId,
            prop_id: propId,
            ai: { mode: prop.ai.mode, ...(prop.ai.prompt ? { prompt: prop.ai.prompt } : {}), ...(prop.ai.language ? { language: prop.ai.language } : {}) },
            ...(prop.type !== 'text' ? { options: (prop.options ?? []).map((x) => ({ id: x.id, name: x.name })), multi: prop.type === 'multi_select' } : {}),
            rows: batch.map((r) => rowForAi(shown, r, propId, { people, rowTitles })),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { values?: Record<string, string | string[]>; error?: string };
        if (!res.ok || !data.values) {
          const code = (['ai_disabled', 'quota_exceeded', 'rate_limited'] as const).find((c) => c === data.error) ?? 'ai_failed';
          latest.current.onError(code);
          return false;
        }
        let next = latest.current.db;
        for (const [rowId, v] of Object.entries(data.values)) {
          const value: DbValue = prop.type === 'text' ? (typeof v === 'string' ? v : '') : prop.type === 'select' ? (Array.isArray(v) ? v[0] ?? null : null) : Array.isArray(v) ? v : [];
          next = setCell(next, rowId, propId, value);
        }
        if (next !== latest.current.db) latest.current.commit(next);
      }
      return true;
    } catch {
      latest.current.onError('ai_failed');
      return false;
    } finally {
      setFilling(null);
    }
  }, []);

  // "Al editar": filas que cambiaron en esta sesión, con un respiro.
  const prev = useRef<DocsDatabase | null>(null);
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const db = o.db;
    const before = prev.current;
    prev.current = db;
    const autoProps = db.properties.filter((p) => p.ai?.auto);
    if (!before || !autoProps.length || !o.editable || !o.source.pageId) return;
    const aiIds = new Set(db.properties.filter((p) => p.ai).map((p) => p.id));
    const old = new Map(before.rows.map((r) => [r.id, r]));
    for (const r of db.rows) {
      const was = old.get(r.id);
      if (!was || contentKey(before, was, aiIds) !== contentKey(db, r, aiIds)) pending.current.add(r.id);
    }
    if (!pending.current.size) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const ids = [...pending.current];
      pending.current.clear();
      void (async () => {
        for (const p of latest.current.db.properties.filter((x) => x.ai?.auto)) {
          if (!(await fill(p.id, ids))) break;
        }
      })();
    }, 2500);
  }, [o.db, o.editable, o.source.pageId, fill]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { fill, filling };
}
