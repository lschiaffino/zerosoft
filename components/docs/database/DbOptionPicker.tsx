'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DbProperty, DbStatusGroup, DbValue, DocsMentionableUser } from '@/lib/docs-types';
import { DB_STATUS_GROUPS, orderedOptions } from '@/lib/docs-database';
import { normalizeSearch } from '@/lib/docs-search';
import { memberName } from './useDbMembers';
import { StatusGlyph } from './DbValueView';

interface Choice {
  id: string;
  label: string;
  group?: DbStatusGroup;
  sub?: string;
}

/**
 * Elegir el valor de una celda con opciones (select, status, multi-select) o
 * personas: buscador, ↑/↓ y Enter. Si no hay match, Enter crea la opción
 * (select/multi/status). Multi y persona alternan y siguen abiertos.
 */
export default function DbOptionPicker({
  prop,
  value,
  members,
  onChange,
  onCreate,
  onDone,
}: {
  prop: DbProperty;
  value: DbValue;
  members: DocsMentionableUser[];
  onChange: (value: DbValue) => void;
  /** Crea una opción con ese nombre y la elige (devuelve su id). */
  onCreate?: (name: string) => void;
  /** Terminó de elegir (select/status cierran solos). */
  onDone: () => void;
}) {
  const t = useTranslations('docs.database');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const multi = prop.type === 'multi_select' || prop.type === 'person';
  const selected = useMemo(
    () => (Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []),
    [value],
  );

  const choices: Choice[] = useMemo(() => {
    if (prop.type === 'person') {
      return members.map((m) => ({ id: m.id, label: memberName(m), sub: m.name ? m.email : undefined }));
    }
    return orderedOptions(prop).map((o) => ({ id: o.id, label: o.name, group: o.group }));
  }, [prop, members]);

  const needle = normalizeSearch(q.trim());
  const filtered = needle ? choices.filter((c) => normalizeSearch(`${c.label} ${c.sub ?? ''}`).includes(needle)) : choices;
  const canCreate =
    Boolean(onCreate) && prop.type !== 'person' && q.trim() !== '' && !choices.some((c) => c.label.trim().toLowerCase() === q.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);
  const sel = Math.min(active, Math.max(0, total - 1));

  const pick = (id: string) => {
    if (multi) {
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
      setQ('');
      return;
    }
    onChange(selected[0] === id ? null : id);
    onDone();
  };

  const create = () => {
    if (!onCreate || !q.trim()) return;
    onCreate(q.trim());
    setQ('');
    if (!multi) onDone();
  };

  const labelOf = (id: string) => choices.find((c) => c.id === id)?.label ?? '';

  const renderChoice = (c: Choice, i: number) => (
    <button
      key={c.id}
      type="button"
      role="option"
      aria-selected={selected.includes(c.id)}
      className={`docs-db-option${i === sel ? ' sel' : ''}${selected.includes(c.id) ? ' on' : ''}`}
      onMouseEnter={() => setActive(i)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(c.id)}
    >
      {prop.type === 'status' && <StatusGlyph group={c.group ?? 'todo'} />}
      <span className="docs-db-option-label">{c.label || t('untitledOption')}</span>
      {c.sub && <span className="docs-db-option-sub">{c.sub}</span>}
      {selected.includes(c.id) && <span className="docs-db-option-check" aria-hidden="true">✓</span>}
    </button>
  );

  let list: React.ReactNode;
  if (prop.type === 'status' && !needle) {
    let i = 0;
    list = DB_STATUS_GROUPS.map((g) => {
      const items = filtered.filter((c) => (c.group ?? 'todo') === g);
      if (items.length === 0) return null;
      return (
        <div key={g} role="group" aria-label={t(`statusGroup.${g}`)}>
          <p className="docs-db-option-group">{t(`statusGroup.${g}`)}</p>
          {items.map((c) => renderChoice(c, i++))}
        </div>
      );
    });
  } else {
    list = filtered.map((c, i) => renderChoice(c, i));
  }

  return (
    <div className="docs-db-picker">
      {multi && selected.length > 0 && (
        <div className="docs-db-picker-chips">
          {selected.map((id) => (
            <span key={id} className="docs-db-chip">
              {labelOf(id) || t('unknownValue')}
              <button
                type="button"
                className="docs-db-chip-x"
                aria-label={t('removeValue', { name: labelOf(id) })}
                onClick={() => onChange(selected.filter((x) => x !== id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="docs-db-picker-input"
        data-autofocus
        value={q}
        placeholder={prop.type === 'person' ? t('searchPeople') : onCreate ? t('searchOrCreate') : t('searchOptions')}
        aria-label={prop.name}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (total) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % total : (a - 1 + total) % total));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (sel < filtered.length && filtered[sel]) pick(filtered[sel].id);
            else if (canCreate) create();
          } else if (e.key === 'Backspace' && !q && multi && selected.length) {
            onChange(selected.slice(0, -1));
          } else if (e.key === 'Tab') {
            onDone();
          }
        }}
      />
      <div className="docs-db-options" role="listbox" aria-multiselectable={multi || undefined} aria-label={prop.name}>
        {!multi && selected.length > 0 && !needle && (
          <button type="button" className="docs-db-option docs-db-option-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(null); onDone(); }}>
            {t('clearValue')}
          </button>
        )}
        {list}
        {filtered.length === 0 && !canCreate && (
          <p className="docs-db-option-empty">{prop.type === 'person' ? t('noPeople') : t('noOptions')}</p>
        )}
        {canCreate && (
          <button
            type="button"
            className={`docs-db-option docs-db-option-create${sel === filtered.length ? ' sel' : ''}`}
            onMouseEnter={() => setActive(filtered.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={create}
          >
            {t('createOption', { name: q.trim() })}
          </button>
        )}
      </div>
    </div>
  );
}
