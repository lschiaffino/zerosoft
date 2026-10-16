'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { ChangelogEntryRow } from '@/lib/db';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/product-taxonomy';

interface ItemOption {
  id: string;
  title: string;
  status: string;
  shipped_changelog_id: string | null;
}

interface Draft {
  date: string;
  titleEn: string;
  titleEs: string;
  titlePt: string;
  bodyEn: string;
  bodyEs: string;
  bodyPt: string;
  products: ProductKey[];
  published: boolean;
  closesItemIds: string[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(): Draft {
  return {
    date: today(),
    titleEn: '',
    titleEs: '',
    titlePt: '',
    bodyEn: '',
    bodyEs: '',
    bodyPt: '',
    products: [],
    published: true,
    closesItemIds: [],
  };
}

function rowToDraft(row: ChangelogEntryRow, items: ItemOption[]): Draft {
  let products: ProductKey[] = [];
  try {
    products = (JSON.parse(row.products) as string[]).filter((p): p is ProductKey =>
      (PRODUCT_KEYS as readonly string[]).includes(p),
    );
  } catch {
    products = [];
  }
  return {
    date: row.date,
    titleEn: row.title_en,
    titleEs: row.title_es,
    titlePt: row.title_pt,
    bodyEn: row.body_en,
    bodyEs: row.body_es,
    bodyPt: row.body_pt,
    products,
    published: row.published === 1,
    closesItemIds: items.filter((i) => i.shipped_changelog_id === row.id).map((i) => i.id),
  };
}

/**
 * Publicar en el changelog sin deploy: título y cuerpo (markdown) en/es/pt,
 * productos y los ítems del roadmap que cierra (pasan a "Lanzado" y se avisa
 * a sus votantes).
 */
export default function ChangelogAdmin({
  initial,
  items,
  locale,
}: {
  initial: ChangelogEntryRow[];
  items: ItemOption[];
  locale: string;
}) {
  const t = useTranslations('changelog.admin');
  const tp = useTranslations('feedbackBoard.product');
  const ts = useTranslations('feedbackBoard.status');
  const [entries, setEntries] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [itemQuery, setItemQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const visibleItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    return items.filter(
      (i) =>
        draft.closesItemIds.includes(i.id) ||
        ((i.status !== 'done' || i.shipped_changelog_id === editing) &&
          i.status !== 'declined' &&
          (!q || i.title.toLowerCase().includes(q))),
    );
  }, [items, itemQuery, draft.closesItemIds, editing]);

  function startEdit(row: ChangelogEntryRow) {
    setEditing(row.id);
    setDraft(rowToDraft(row, items));
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    setEditing(null);
    setDraft(emptyDraft());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !draft.titleEn.trim()) return;
    if (draft.closesItemIds.length > 0 && draft.published && !window.confirm(t('closeConfirm', { count: draft.closesItemIds.length }))) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch(editing ? `/api/changelog-entries/${encodeURIComponent(editing)}` : '/api/changelog-entries', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { entry?: ChangelogEntryRow } | null) : null;
    if (data?.entry) {
      const entry = data.entry;
      setEntries((list) =>
        editing ? list.map((x) => (x.id === editing ? entry : x)) : [entry, ...list].sort((a, b) => b.date.localeCompare(a.date)),
      );
      setMessage({ kind: 'ok', text: draft.published ? t('published') : t('savedDraft') });
      reset();
    } else {
      setMessage({ kind: 'error', text: t('error') });
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!window.confirm(t('deleteConfirm'))) return;
    const res = await fetch(`/api/changelog-entries/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      setEntries((list) => list.filter((x) => x.id !== id));
      if (editing === id) reset();
    } else setMessage({ kind: 'error', text: t('error') });
  }

  return (
    <>
      <form className="cla-form" onSubmit={submit}>
        <p className="section-label">{editing ? t('editTitle', { id: editing }) : t('newTitle')}</p>
        <label className="bp-field">
          <span className="label">{t('date')}</span>
          <input className="input" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} required />
        </label>
        <div className="cla-grid">
          {(['En', 'Es', 'Pt'] as const).map((l) => (
            <label key={l} className="bp-field">
              <span className="label">{t(`title${l}`)}</span>
              <input
                className="input"
                value={draft[`title${l}`]}
                maxLength={200}
                required={l === 'En'}
                onChange={(e) => set(`title${l}`, e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="cla-grid">
          {(['En', 'Es', 'Pt'] as const).map((l) => (
            <label key={l} className="bp-field">
              <span className="label">{t(`body${l}`)}</span>
              <textarea
                className="textarea mono"
                rows={8}
                value={draft[`body${l}`]}
                onChange={(e) => set(`body${l}`, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="bp-hint">{t('bodyHint')}</p>

        <fieldset className="bp-field">
          <legend className="label">{t('products')}</legend>
          <div className="cla-products">
            {PRODUCT_KEYS.map((p) => (
              <label key={p} className="bp-check">
                <input
                  type="checkbox"
                  checked={draft.products.includes(p)}
                  onChange={(e) =>
                    set('products', e.target.checked ? [...draft.products, p] : draft.products.filter((x) => x !== p))
                  }
                />
                {tp(p)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="bp-field">
          <span className="label">{t('closes')}</span>
          <input
            className="input"
            type="search"
            value={itemQuery}
            onChange={(e) => setItemQuery(e.target.value)}
            placeholder={t('closesSearch')}
            aria-label={t('closesSearch')}
          />
          <div className="cla-items">
            {visibleItems.length === 0 && <span className="bp-hint">{t('closesEmpty')}</span>}
            {visibleItems.map((i) => (
              <label key={i.id} className="bp-check">
                <input
                  type="checkbox"
                  checked={draft.closesItemIds.includes(i.id)}
                  onChange={(e) =>
                    set(
                      'closesItemIds',
                      e.target.checked ? [...draft.closesItemIds, i.id] : draft.closesItemIds.filter((x) => x !== i.id),
                    )
                  }
                />
                {i.title} <span className="bp-hint">{i.status === 'proposed' ? t('triage') : ts(i.status)}</span>
              </label>
            ))}
          </div>
          <span className="bp-hint">{t('closesHint')}</span>
        </div>

        <label className="bp-check">
          <input type="checkbox" checked={draft.published} onChange={(e) => set('published', e.target.checked)} />
          {t('publishedLabel')}
        </label>

        <div className="form-actions">
          <button type="submit" className="btn btn-solid btn-small" disabled={busy || !draft.titleEn.trim()}>
            {editing ? t('save') : t('publish')}
          </button>
          {editing && (
            <button type="button" className="btn btn-ghost btn-small" onClick={reset}>
              {t('cancel')}
            </button>
          )}
          {message && (
            <span className={`rm-admin-status${message.kind === 'error' ? ' is-error' : ''}`} role="status">
              {message.text}
            </span>
          )}
        </div>
      </form>

      <ul className="cla-list">
        {entries.length === 0 && <li className="muted">{t('empty')}</li>}
        {entries.map((row) => (
          <li key={row.id}>
            <span className="mono">{row.date}</span>
            <strong>{locale === 'es' ? row.title_es || row.title_en : locale === 'pt' ? row.title_pt || row.title_en : row.title_en}</strong>
            {row.published !== 1 && <span className="mono">{t('draft')}</span>}
            <span className="rm-admin-spacer" />
            <button type="button" className="bp-link-btn" onClick={() => startEdit(row)}>
              {t('edit')}
            </button>
            <button type="button" className="bp-link-btn" onClick={() => remove(row.id)}>
              {t('delete')}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
