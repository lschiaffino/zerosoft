'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getDocTemplates } from '@/lib/docs-templates';

interface PageLite {
  id: string;
  title: string;
}

/**
 * Buscador de páginas de Docs para los pasos de Docs. Elegir una pone su id
 * en el campo; el campo sigue aceptando variables ({{trigger.page.id}}).
 */
export function DocsPagePicker({ value, onPick }: { value: string; onPick: (pageId: string) => void }) {
  const t = useTranslations('flow.docsPicker');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PageLite[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (!value || value.includes('{{')) {
      setCurrent(null);
      return;
    }
    let alive = true;
    fetch(`/api/docs/pages/${encodeURIComponent(value)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { title?: string } | null) => {
        if (alive) setCurrent(d ? d.title || t('untitled') : t('missing'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value, t]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 1) {
      setRows([]);
      return;
    }
    const id = setTimeout(() => {
      fetch(`/api/docs/search?q=${encodeURIComponent(needle)}`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows?: Array<PageLite & { row_id?: string }> }) => setRows((d.rows ?? []).filter((r) => !r.row_id).slice(0, 8)))
        .catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="flow-groups-picker">
      {current && <p className="ui-help">{t('current', { name: current })}</p>}
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPages')} aria-label={t('searchPages')} />
      {rows.length > 0 && (
        <ul className="flow-groups-results" role="listbox" aria-label={t('searchPages')}>
          {rows.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === value}>
              <button
                type="button"
                onClick={() => {
                  onPick(p.id);
                  setCurrent(p.title || t('untitled'));
                  setQ('');
                  setRows([]);
                }}
              >
                {p.title || t('untitled')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface DatabaseLite {
  page_id: string;
  page_title: string;
  block_id: string;
  title: string;
  properties: Array<{ id: string; name: string; type: string }>;
}

/** Selector de una base de Docs ("página/bloque") con sus propiedades como ayuda. */
export function DocsDatabasePicker({
  id,
  value,
  readOnly,
  onPick,
}: {
  id: string;
  value: string;
  readOnly?: boolean;
  onPick: (ref: string) => void;
}) {
  const t = useTranslations('flow.docsPicker');
  const [rows, setRows] = useState<DatabaseLite[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/docs/databases')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { rows?: DatabaseLite[] }) => {
        if (alive) setRows(d.rows ?? []);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  const picked = rows?.find((r) => `${r.page_id}/${r.block_id}` === value) ?? null;
  const missing = value !== '' && rows !== null && !picked;
  return (
    <>
      <select id={id} className="select" value={value} disabled={readOnly || rows === null} onChange={(e) => onPick(e.target.value)}>
        <option value="">{rows === null ? t('loading') : t('pickDatabase')}</option>
        {missing && <option value={value}>{t('missing')}</option>}
        {(rows ?? []).map((r) => (
          <option key={`${r.page_id}/${r.block_id}`} value={`${r.page_id}/${r.block_id}`}>
            {(r.title || t('untitled')) + (r.page_title && r.page_title !== r.title ? ` · ${r.page_title}` : '')}
          </option>
        ))}
      </select>
      <p className="ui-help">
        {error
          ? t('loadError')
          : picked
            ? t('properties', { list: picked.properties.map((p) => p.name).join(', ') })
            : rows && rows.length === 0
              ? t('noDatabases')
              : t('databaseHelp')}
      </p>
    </>
  );
}

interface TemplateLite {
  id: string;
  title: string;
}

/** Plantilla para "crear página": las del workspace y las integradas (builtin:<key>). */
export function DocsTemplatePicker({ id, value, readOnly, onPick }: { id: string; value: string; readOnly?: boolean; onPick: (v: string) => void }) {
  const t = useTranslations('flow.docsPicker');
  const locale = useLocale();
  const [rows, setRows] = useState<TemplateLite[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/docs/templates')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: TemplateLite[] }) => {
        if (alive) setRows(d.rows ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const builtin = getDocTemplates(locale).filter((tpl) => tpl.key !== 'blank');
  return (
    <>
      <select id={id} className="select" value={value} disabled={readOnly} onChange={(e) => onPick(e.target.value)}>
        <option value="">{t('noTemplate')}</option>
        {rows.length > 0 && (
          <optgroup label={t('workspaceTemplates')}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title || t('untitled')}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={t('builtinTemplates')}>
          {builtin.map((tpl) => (
            <option key={tpl.key} value={`builtin:${tpl.key}`}>
              {tpl.title}
            </option>
          ))}
        </optgroup>
      </select>
      <p className="ui-help">{t('templateHelp')}</p>
    </>
  );
}
