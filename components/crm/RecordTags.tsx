'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { TagEntity } from '@/lib/crm-constants';
import { tagColorVar, type TagDot } from './TagDots';
import CrmIcon from './CrmIcon';

interface RecordTagsProps {
  entity: TagEntity;
  recordId: string;
  tags: TagDot[];
  /** Todos los tags del workspace (para elegir). */
  allTags: TagDot[];
}

/**
 * Editor de tags del header de un registro: tags actuales (punto + texto,
 * quitar con ✕) y un "+ Tag" que abre un selector con los existentes o crea
 * uno nuevo escribiendo el nombre.
 */
export default function RecordTags({ entity, recordId, tags, allTags }: RecordTagsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [current, setCurrent] = useState<TagDot[]>(tags);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(ids: string[]) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/tags/record', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity, recordId, tagIds: ids }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    const data = (await res.json()) as { tags: TagDot[] };
    setCurrent(data.tags);
    router.refresh();
  }

  async function createAndAdd() {
    const n = name.trim();
    if (!n) return;
    const existing = allTags.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      if (!current.some((c) => c.id === existing.id)) await save([...current.map((c) => c.id), existing.id]);
      setName('');
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: n }),
    }).catch(() => null);
    setBusy(false);
    if (!res || res.status !== 201) {
      setError(t('errors.generic'));
      return;
    }
    const tag = (await res.json()) as TagDot;
    await save([...current.map((c) => c.id), tag.id]);
    setName('');
    setOpen(false);
  }

  const available = allTags.filter((x) => !current.some((c) => c.id === x.id));

  return (
    <div className="record-tags">
      {current.map((tag) => (
        <span className="tag-dot" key={tag.id}>
          <span className="tag-dot-mark" style={{ background: tagColorVar(tag.color) }} aria-hidden />
          {tag.name}
          <button
            type="button"
            className="tag-remove"
            disabled={busy}
            aria-label={`${t('tags.remove')} ${tag.name}`}
            onClick={() => save(current.filter((c) => c.id !== tag.id).map((c) => c.id))}
          >
            <CrmIcon name="x" />
          </button>
        </span>
      ))}
      {open ? (
        <span className="record-tags-add">
          {available.length > 0 && (
            <select
              className="filter-select"
              value=""
              disabled={busy}
              aria-label={t('tags.pick')}
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  void save([...current.map((c) => c.id), id]);
                  setOpen(false);
                }
              }}
            >
              <option value="">{t('tags.pick')}</option>
              {available.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          <input
            className="input record-tags-input"
            value={name}
            placeholder={t('tags.newPlaceholder')}
            aria-label={t('tags.newPlaceholder')}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void createAndAdd();
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <button type="button" className="btn btn-small" disabled={busy || !name.trim()} onClick={createAndAdd}>
            {t('tags.create')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
        </span>
      ) : (
        <button type="button" className="record-tags-plus" onClick={() => setOpen(true)} data-testid="record-tags-add">
          {t('tags.add')}
        </button>
      )}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
