'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SchemaTable } from '@/lib/bi/types';

const KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'JOIN', 'LEFT JOIN', 'ON', 'AND', 'OR', 'NOT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'HAVING', 'BETWEEN', 'LIKE', 'IN', 'IS NULL', 'DESC', 'ASC', 'WITH'];

interface Suggestion {
  text: string;
  kind: 'table' | 'column' | 'keyword';
  detail?: string;
}

/**
 * Editor SQL: textarea con autocompletado de tablas, columnas y palabras
 * clave (↑↓ elige, Enter o Tab completa, Esc cierra; Cmd/Ctrl+Enter corre) y
 * el navegador de esquema al costado (clic inserta el nombre).
 */
export default function SqlEditor({ value, onChange, onRun, schema, label }: { value: string; onChange: (v: string) => void; onRun: () => void; schema: SchemaTable[]; label: string }) {
  const t = useTranslations('bi.sql');
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [word, setWord] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!word || word.length < 1) return [];
    const w = word.toLowerCase();
    const out: Suggestion[] = [];
    const dot = w.lastIndexOf('.');
    if (dot > 0) {
      const tableName = w.slice(0, dot);
      const rest = w.slice(dot + 1);
      const tbl = schema.find((tb) => tb.name.toLowerCase() === tableName || tb.name.toLowerCase().endsWith(`.${tableName}`));
      for (const c of tbl?.columns ?? []) if (c.name.toLowerCase().startsWith(rest)) out.push({ text: `${word.slice(0, dot + 1)}${c.name}`, kind: 'column', detail: c.type });
      return out.slice(0, 8);
    }
    for (const tb of schema) if (tb.name.toLowerCase().startsWith(w)) out.push({ text: tb.name, kind: 'table' });
    const seen = new Set<string>();
    for (const tb of schema)
      for (const c of tb.columns)
        if (c.name.toLowerCase().startsWith(w) && !seen.has(c.name)) {
          seen.add(c.name);
          out.push({ text: c.name, kind: 'column', detail: tb.name });
        }
    for (const k of KEYWORDS) if (k.toLowerCase().startsWith(w) && k.toLowerCase() !== w) out.push({ text: k, kind: 'keyword' });
    return out.slice(0, 8);
  }, [word, schema]);

  const updateWord = () => {
    const el = ref.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const m = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(before);
    setWord(m ? m[0] : '');
    setActive(0);
    setOpen(!!m);
  };

  const insert = (text: string, replaceWord: boolean) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart - (replaceWord ? word.length : 0);
    const end = el.selectionEnd;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const showList = open && suggestions.length > 0;
  const tables = schema.filter((tb) => !tableFilter || tb.name.toLowerCase().includes(tableFilter.toLowerCase()));

  return (
    <div className="bi-sql">
      <div className="bi-sql-main">
        <textarea
          ref={ref}
          className="input bi-sql-input"
          value={value}
          spellCheck={false}
          aria-label={label}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            requestAnimationFrame(updateWord);
          }}
          onClick={() => setOpen(false)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onRun();
              return;
            }
            if (!showList) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insert(suggestions[active].text, true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
          rows={10}
          data-testid="bi-sql-input"
        />
        {showList && (
          <ul className="bi-suggest" id={listId} role="listbox" aria-label={t('suggestions')}>
            {suggestions.map((s, i) => (
              <li
                key={`${s.kind}-${s.text}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(s.text, true);
                }}
              >
                <span className={`bi-suggest-kind bi-suggest-${s.kind}`}>{t(`kind.${s.kind}`)}</span>
                <span className="bi-suggest-text">{s.text}</span>
                {s.detail && <span className="bi-muted">{s.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="bi-muted bi-sql-hint">{t('hint')}</p>
      </div>
      <aside className="bi-schema" aria-label={t('schema')}>
        <div className="bi-schema-head">
          <span>{t('schema')}</span>
        </div>
        <input className="input bi-schema-filter" type="search" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} placeholder={t('filterTables')} aria-label={t('filterTables')} />
        {schema.length === 0 ? (
          <p className="bi-muted">{t('noTables')}</p>
        ) : (
          <ul className="bi-schema-list" role="list">
            {tables.map((tb) => (
              <li key={tb.name}>
                <div className="bi-schema-table">
                  <button type="button" className="bi-schema-toggle" aria-expanded={expanded === tb.name} onClick={() => setExpanded(expanded === tb.name ? null : tb.name)}>
                    <span aria-hidden="true">{expanded === tb.name ? '▾' : '▸'}</span> {tb.name}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => insert(tb.name, false)} aria-label={t('insert', { name: tb.name })}>
                    +
                  </button>
                </div>
                {expanded === tb.name && (
                  <ul className="bi-schema-cols" role="list">
                    {tb.columns.map((c) => (
                      <li key={c.name}>
                        <button type="button" className="bi-schema-col" onClick={() => insert(c.name, false)} aria-label={t('insert', { name: c.name })}>
                          <span>{c.name}</span>
                          <span className="bi-muted">{t(`type.${c.type}`)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
