'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DbPropertyType, DocsDatabase, DocsMentionableUser } from '@/lib/docs-types';
import { isComputedType, titleProperty } from '@/lib/docs-database';
import { CSV_IMPORT_TYPES, CSV_MAX_BYTES, importCsvRows, parseCsv, planCsvImport, type CsvColumnPlan, type CsvTarget } from '@/lib/docs-db-csv';
import { typeKey } from './DbPropertyMenu';

function targetValue(t: CsvTarget): string {
  if (t.kind === 'skip') return 'skip';
  if (t.kind === 'title') return 'title';
  if (t.kind === 'existing') return `existing:${t.propId}`;
  return `new:${t.type}`;
}

/** Saca las filas vacías de una base recién creada (la fila en blanco de /database) antes de importar. */
function dropBlankRows(db: DocsDatabase): DocsDatabase {
  const rows = db.rows.filter((r) => Object.keys(r.values).length > 0 || r.body?.length || r.files);
  return rows.length === db.rows.length ? db : { ...db, rows };
}

/**
 * Importar un CSV a la base (como "Merge with CSV" de Notion): cada columna
 * va al título, a una propiedad que ya existe, a una nueva (con el tipo que
 * se elija; los select crean sus opciones) o se saltea.
 */
export function DbCsvImport({
  db,
  members,
  onImport,
  onClose,
}: {
  db: DocsDatabase;
  members: DocsMentionableUser[];
  onImport: (next: DocsDatabase, added: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations('docs.database');
  const input = useRef<HTMLInputElement | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [plan, setPlan] = useState<CsvColumnPlan[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const existing = db.properties.filter((p) => p.type !== 'title' && !isComputedType(p.type) && p.type !== 'relation' && p.type !== 'files');

  const read = async (file: File) => {
    setError(null);
    if (file.size > CSV_MAX_BYTES) {
      setError(t('csv.tooLarge'));
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setError(t('csv.empty'));
      return;
    }
    setFileName(file.name);
    setTable(parsed);
    setPlan(planCsvImport(parsed, db));
  };

  const setTarget = (index: number, v: string) => {
    const target: CsvTarget =
      v === 'skip'
        ? { kind: 'skip' }
        : v === 'title'
          ? { kind: 'title' }
          : v.startsWith('existing:')
            ? { kind: 'existing', propId: v.slice(9) }
            : { kind: 'new', type: v.slice(4) as DbPropertyType, name: plan[index]?.header ?? '' };
    setPlan((cur) =>
      cur.map((c, i) => {
        if (i === index) return { ...c, target };
        // Un solo título: el que estaba pasa a texto nuevo.
        if (target.kind === 'title' && c.target.kind === 'title') return { ...c, target: { kind: 'new', type: 'text', name: c.header } };
        return c;
      }),
    );
  };

  const rows = table ? table.length - 1 : 0;

  return (
    <div className="docs-db-panel docs-db-csv" aria-label={t('csv.importTitle')} data-testid="docs-db-csv-import">
      <p className="docs-db-menu-label">{t('csv.importTitle')}</p>
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,text/csv,text/tab-separated-values"
        hidden
        data-testid="docs-db-csv-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
          e.target.value = '';
        }}
      />
      {!table && (
        <>
          <p className="docs-db-hint">{t('csv.importHint')}</p>
          <button type="button" className="btn btn-sm" data-autofocus onClick={() => input.current?.click()}>
            {t('csv.pickFile')}
          </button>
        </>
      )}
      {error && (
        <p className="docs-db-error" role="alert">
          {error}
        </p>
      )}
      {table && (
        <>
          <p className="docs-db-hint">{t('csv.summary', { file: fileName, rows, columns: plan.length })}</p>
          <div className="docs-db-csv-map" role="table" aria-label={t('csv.mapping')}>
            {plan.map((c, i) => (
              <div key={c.index} className="docs-db-csv-col" role="row">
                <span className="docs-db-csv-head" role="cell">
                  <strong>{c.header}</strong>
                  <span className="docs-db-muted">{(table[1]?.[c.index] ?? '').slice(0, 40)}</span>
                </span>
                <select className="docs-db-select" role="cell" aria-label={t('csv.mapColumn', { name: c.header })} value={targetValue(c.target)} onChange={(e) => setTarget(i, e.target.value)}>
                  <option value="title">{t('csv.toTitle', { name: titleProperty(db).name })}</option>
                  {existing.length > 0 && (
                    <optgroup label={t('csv.existing')}>
                      {existing.map((p) => (
                        <option key={p.id} value={`existing:${p.id}`}>
                          {p.name || t('untitledProperty')}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={t('csv.newProperty')}>
                    {CSV_IMPORT_TYPES.map((type) => (
                      <option key={type} value={`new:${type}`}>
                        {t('csv.newAs', { type: t(typeKey(type)) })}
                      </option>
                    ))}
                  </optgroup>
                  <option value="skip">{t('csv.skip')}</option>
                </select>
              </div>
            ))}
          </div>
          <div className="docs-db-panel-foot">
            <button
              type="button"
              className="btn btn-sm"
              data-testid="docs-db-csv-confirm"
              onClick={() => {
                const res = importCsvRows(dropBlankRows(db), table, plan, { members });
                onImport(res.db, res.added);
                if (res.skipped) setError(t('csv.skipped', { n: res.skipped }));
                else onClose();
              }}
            >
              {t('csv.import', { n: rows })}
            </button>
            <button type="button" className="docs-db-link-btn" onClick={() => setTable(null)}>
              {t('csv.otherFile')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Descarga un CSV en el navegador. */
export function downloadCsv(name: string, csv: string) {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(name || 'database').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'database'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
