'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboOption {
  value: string;
  label: string;
}

interface RecordComboboxProps {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  /** Texto de la opción vacía ("Sin contacto"). */
  noneLabel: string;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Búsqueda en el servidor (más allá de las opciones precargadas). Devuelve opciones. */
  search?: (q: string) => Promise<ComboOption[]>;
}

/**
 * Selector buscable de un registro (contacto, empresa): se tipea para filtrar,
 * flechas para moverse, Enter elige y Esc cierra la lista sin cerrar el diálogo.
 * Si recibe `search`, completa con resultados del servidor.
 */
export default function RecordCombobox({
  options,
  value,
  onChange,
  noneLabel,
  placeholder,
  ariaLabel,
  disabled,
  search,
}: RecordComboboxProps) {
  const listId = useId();
  const [extra, setExtra] = useState<ComboOption[]>([]);
  const all = useMemo(() => {
    const seen = new Set(options.map((o) => o.value));
    return [...options, ...extra.filter((o) => !seen.has(o.value))];
  }, [options, extra]);
  const selected = all.find((o) => o.value === value);
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const reqRef = useRef(0);

  // Al cambiar el valor desde afuera (reset del formulario), el texto lo sigue.
  useEffect(() => {
    if (!open) setQuery(selected?.label ?? '');
  }, [selected?.label, open]);

  const q = query.trim().toLowerCase();
  const filtering = open && q !== '' && q !== (selected?.label ?? '').toLowerCase();
  const matches = (filtering ? all.filter((o) => o.label.toLowerCase().includes(q)) : all).slice(0, 50);
  const items: ComboOption[] = [{ value: '', label: noneLabel }, ...matches];

  useEffect(() => {
    if (!search || !filtering || q.length < 2) return;
    const id = ++reqRef.current;
    const timer = window.setTimeout(() => {
      void search(q)
        .then((res) => {
          if (id === reqRef.current) setExtra((prev) => [...prev, ...res.filter((r) => !prev.some((p) => p.value === r.value))]);
        })
        .catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search, filtering, q]);

  function choose(opt: ComboOption) {
    onChange(opt.value);
    setQuery(opt.value ? opt.label : '');
    setOpen(false);
    setActive(-1);
  }

  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="crm-combo">
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        placeholder={selected ? selected.label : placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
          if (e.target.value === '' && value) onChange('');
        }}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onBlur={() =>
          window.setTimeout(() => {
            setOpen(false);
            setQuery(selected?.label ?? '');
          }, 150)
        }
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const pick = items[active >= 0 ? active : filtering ? 1 : 0];
            if (pick) choose(pick);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setQuery(selected?.label ?? '');
          }
        }}
      />
      {open && (
        <ul className="crm-combo-options" role="listbox" id={listId} aria-label={ariaLabel}>
          {items.map((o, i) => (
            <li key={o.value || '__none'} role="presentation">
              <button
                type="button"
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={o.value === value}
                className={`${i === active ? 'is-active' : ''}${o.value ? '' : ' is-none'}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
