'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export interface PickedContact {
  id: string;
  name: string;
  email: string;
}

/**
 * Combobox de contactos: busca con debounce en /api/crm/contacts, flechas
 * para moverse, Enter elige, Esc cierra. Con un contacto elegido muestra su
 * nombre y un botón para quitarlo.
 */
export default function ContactPicker({
  value,
  onChange,
  label,
  id: idProp,
}: {
  value: PickedContact | null;
  onChange: (c: PickedContact | null) => void;
  label: string;
  id?: string;
}) {
  const t = useTranslations('crm.media');
  const auto = useId();
  const id = idProp ?? `cp-${auto}`;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedContact[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const needle = q.trim();
    if (!needle) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      fetch(`/api/crm/contacts?q=${encodeURIComponent(needle)}&pageSize=6`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows: Array<{ id: string; first_name: string; last_name: string; email: string }> }) => {
          setResults(d.rows.map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim() || c.email, email: c.email })));
          setActive(0);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  if (value) {
    return (
      <div className="ui-field">
        <span className="label">{label}</span>
        <div className="cp-picked">
          <span>
            {value.name}
            {value.email && value.email !== value.name ? <span className="muted"> · {value.email}</span> : null}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            {t('changeContact')}
          </button>
        </div>
      </div>
    );
  }

  const listId = `${id}-list`;
  return (
    <div className="ui-field cp">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        value={q}
        placeholder={t('searchContact')}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && results[active]) {
            e.preventDefault();
            onChange(results[active]);
            setQ('');
            setOpen(false);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {loading && <span className="ui-help">{t('searching')}</span>}
      {open && q.trim() && !loading && (
        <ul className="cp-list" id={listId} role="listbox">
          {results.length === 0 && <li className="cp-empty">{t('noContacts')}</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c);
                setQ('');
                setOpen(false);
              }}
            >
              <span>{c.name}</span>
              {c.email && <span className="muted"> {c.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
