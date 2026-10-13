'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { TAG_COLORS } from '@/lib/crm-constants';
import { tagColorVar } from './TagDots';

export interface ManagedTag {
  id: string;
  name: string;
  color: string;
  contacts: number;
  companies: number;
  deals: number;
}

function Swatches({ value, onPick, disabled }: { value: string; onPick: (c: string) => void; disabled?: boolean }) {
  const t = useTranslations('crm');
  return (
    <span className="tag-swatches" role="radiogroup" aria-label={t('tags.color')}>
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c}
          disabled={disabled}
          className={`tag-swatch${value === c ? ' is-on' : ''}`}
          style={{ background: tagColorVar(c) }}
          onClick={() => onPick(c)}
        />
      ))}
    </span>
  );
}

/** Ajustes › Tags: crear, renombrar, cambiar color y borrar. */
export default function TagsManager({ initialTags }: { initialTags: ManagedTag[] }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [tags, setTags] = useState<ManagedTag[]>(initialTags);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('crm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function errorFrom(code: string | undefined) {
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), color }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as (ManagedTag & { error?: string }) | null;
    if (!res || res.status !== 201 || !data) return errorFrom(data?.error);
    setTags((prev) =>
      [...prev, { ...data, contacts: 0, companies: 0, deals: 0 }].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setName('');
    router.refresh();
  }

  async function patch(id: string, body: { name?: string; color?: string }) {
    setError(null);
    const res = await fetch(`/api/crm/tags/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (ManagedTag & { error?: string }) | null;
    if (!res?.ok || !data) return errorFrom(data?.error);
    setTags((prev) => prev.map((x) => (x.id === id ? { ...x, name: data.name, color: data.color } : x)));
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/crm/tags/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) return errorFrom(undefined);
    setTags((prev) => prev.filter((x) => x.id !== id));
    setConfirmId(null);
    router.refresh();
  }

  return (
    <div className="tags-manager">
      <form className="tags-create" onSubmit={create}>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('tags.newPlaceholder')}
          aria-label={t('tags.name')}
          maxLength={60}
        />
        <Swatches value={color} onPick={setColor} disabled={busy} />
        <button type="submit" className="btn btn-solid btn-small" disabled={busy || !name.trim()}>
          {t('tags.create')}
        </button>
      </form>

      {tags.length === 0 ? (
        <p className="muted">{t('tags.empty')}</p>
      ) : (
        <ul className="tags-list">
          {tags.map((tag) => (
            <li className="tags-row" key={tag.id}>
              <span className="tag-dot-mark" style={{ background: tagColorVar(tag.color) }} aria-hidden />
              <input
                className="input tags-name"
                defaultValue={tag.name}
                aria-label={t('tags.name')}
                maxLength={60}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== tag.name) void patch(tag.id, { name: v });
                  else e.target.value = tag.name;
                }}
              />
              <Swatches value={tag.color} onPick={(c) => patch(tag.id, { color: c })} />
              <span className="muted mono tags-count">
                {t('tags.counts', { contacts: tag.contacts, companies: tag.companies, deals: tag.deals })}
              </span>
              {confirmId === tag.id ? (
                <span className="tags-confirm">
                  <button type="button" className="btn btn-small btn-danger" onClick={() => remove(tag.id)}>
                    {t('tags.confirmDelete')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmId(null)}>
                    {t('common.cancel')}
                  </button>
                </span>
              ) : (
                <button type="button" className="chip-remove" aria-label={`${t('tags.delete')} ${tag.name}`} onClick={() => setConfirmId(tag.id)}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
