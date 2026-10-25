'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DbFile } from '@/lib/docs-types';
import { normalizeSearch } from '@/lib/docs-search';
import { formatFileSize } from '@/lib/docs-files';

export interface RelationChoice {
  id: string;
  title: string;
}

/**
 * Elegir filas de la base relacionada (como el selector de relación de
 * Notion): buscador, ↑/↓, Enter alterna, y "Nueva fila" crea una en la otra
 * base con lo tipeado. Con límite 1 elegir reemplaza.
 */
export function DbRelationPicker({
  label,
  choices,
  status,
  value: rawValue,
  single,
  onChange,
  onCreate,
  onDone,
}: {
  label: string;
  choices: RelationChoice[];
  status: 'loading' | 'ready' | 'error';
  value: string[];
  single?: boolean;
  onChange: (ids: string[]) => void;
  onCreate?: (title: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const t = useTranslations('docs.database');
  // Filas que ya no existen en la otra base (borradas allá): no se muestran y se van al editar.
  const value = useMemo(() => (status === 'ready' ? rawValue.filter((id) => choices.some((c) => c.id === id)) : rawValue), [status, rawValue, choices]);
  const [q, setQ] = useState('');
  // null: la primera fila sin elegir (Enter agrega, nunca quita).
  const [active, setActive] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const needle = normalizeSearch(q.trim());
  const filtered = useMemo(() => {
    const list = needle ? choices.filter((c) => normalizeSearch(c.title).includes(needle)) : choices;
    // Las elegidas primero (como Notion).
    return [...list.filter((c) => value.includes(c.id)), ...list.filter((c) => !value.includes(c.id))].slice(0, 200);
  }, [choices, needle, value]);
  const canCreate = Boolean(onCreate) && q.trim() !== '' && !choices.some((c) => c.title.trim().toLowerCase() === q.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);
  const firstFree = filtered.findIndex((c) => !value.includes(c.id));
  const sel = Math.min(active ?? (firstFree === -1 ? filtered.length : firstFree), Math.max(0, total - 1));
  const titleOf = (id: string) => choices.find((c) => c.id === id)?.title || t('untitledRow');

  const toggle = (id: string) => {
    if (single) {
      onChange(value[0] === id ? [] : [id]);
      onDone();
      return;
    }
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  const create = async () => {
    if (!onCreate || creating) return;
    setCreating(true);
    const id = await onCreate(q.trim());
    setCreating(false);
    setQ('');
    if (id) onChange(single ? [id] : [...value, id]);
    if (single) onDone();
  };

  return (
    <div className="docs-db-picker" data-testid="docs-db-relation-picker">
      {value.length > 0 && (
        <div className="docs-db-picker-chips">
          {value.map((id) => (
            <span key={id} className="docs-db-relchip">
              {titleOf(id)}
              <button type="button" className="docs-db-chip-x" aria-label={t('removeValue', { name: titleOf(id) })} onClick={() => onChange(value.filter((x) => x !== id))}>
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
        placeholder={onCreate ? t('relation.searchOrCreate') : t('relation.search')}
        aria-label={label}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (total) setActive(e.key === 'ArrowDown' ? (sel + 1) % total : (sel - 1 + total) % total);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            // Enter agrega la fila marcada; quitar es con × o con un click (como Notion).
            if (sel < filtered.length && filtered[sel]) {
              if (!value.includes(filtered[sel].id)) toggle(filtered[sel].id);
              else if (single) onDone();
            } else if (canCreate) void create();
          } else if (e.key === 'Tab') {
            onDone();
          }
        }}
      />
      <div className="docs-db-options" role="listbox" aria-multiselectable={!single || undefined} aria-label={label}>
        {status === 'loading' && <p className="docs-db-option-empty">{t('relation.loading')}</p>}
        {status === 'error' && <p className="docs-db-option-empty">{t('relation.loadError')}</p>}
        {status === 'ready' &&
          filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={value.includes(c.id)}
              className={`docs-db-option${i === sel ? ' sel' : ''}${value.includes(c.id) ? ' on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(c.id)}
            >
              <span className="docs-db-option-label">{c.title || t('untitledRow')}</span>
              {value.includes(c.id) && <span className="docs-db-option-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        {status === 'ready' && filtered.length === 0 && !canCreate && <p className="docs-db-option-empty">{t('relation.noRows')}</p>}
        {canCreate && (
          <button
            type="button"
            className={`docs-db-option docs-db-option-create${sel === filtered.length ? ' sel' : ''}`}
            disabled={creating}
            onMouseEnter={() => setActive(filtered.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void create()}
          >
            {t('relation.newRow', { name: q.trim() })}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Archivos de una celda files: lista con link, quitar y subir (botón o
 * soltar). Sube a /api/docs/pages/<página>/files, como los bloques de archivo.
 */
export function DbFilesEditor({
  label,
  files,
  href,
  upload,
  onChange,
}: {
  label: string;
  files: DbFile[];
  href: (fileId: string) => string | null;
  upload: ((file: File) => Promise<DbFile>) | null;
  onChange: (files: DbFile[]) => void;
}) {
  const t = useTranslations('docs.database');
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(files);
  current.current = files;

  const add = async (list: FileList | File[]) => {
    if (!upload) return;
    setBusy(true);
    setError(null);
    let next = [...current.current];
    for (const f of Array.from(list).slice(0, 20 - next.length)) {
      try {
        next = [...next, await upload(f)];
        onChange(next);
      } catch (e) {
        setError((e as Error).message === 'file_too_large' ? t('files.tooLarge') : t('files.uploadError'));
      }
    }
    setBusy(false);
  };

  return (
    <div
      className="docs-db-files"
      data-testid="docs-db-files"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void add(e.dataTransfer.files);
      }}
    >
      {files.length === 0 && <p className="docs-db-option-empty">{t('files.empty')}</p>}
      <ul className="docs-db-files-list" aria-label={label}>
        {files.map((f) => {
          const url = f.url ? href(f.id) : null;
          return (
            <li key={f.id} className="docs-db-files-item">
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="docs-db-filechip">
                  {f.name}
                </a>
              ) : (
                <span className="docs-db-filechip">{f.name}</span>
              )}
              {typeof f.size === 'number' && <span className="docs-db-muted">{formatFileSize(f.size)}</span>}
              {upload && (
                <button type="button" className="docs-db-remove" aria-label={t('files.remove', { name: f.name })} title={t('files.remove', { name: f.name })} onClick={() => onChange(files.filter((x) => x.id !== f.id))}>
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {upload && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void add(e.target.files);
              e.target.value = '';
            }}
          />
          <button type="button" className="docs-db-link-btn" data-autofocus disabled={busy || files.length >= 20} onClick={() => input.current?.click()}>
            {busy ? t('files.uploading') : t('files.add')}
          </button>
        </>
      )}
      {error && (
        <p className="docs-db-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
