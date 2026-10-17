'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { ChangelogEntryRow } from '@/lib/db';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/product-taxonomy';
import AdvancedSection from '@/components/ui/AdvancedSection';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';

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
  const tStatus = useTranslations('feedbackBoard.status');
  const ts = useTranslations('settings.admin');
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
    document.getElementById('changelog-form')?.scrollIntoView({ block: 'start' });
    window.setTimeout(() => document.getElementById('st-cl-title-en')?.focus(), 0);
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

  const titleFor = (row: ChangelogEntryRow) =>
    locale === 'es' ? row.title_es || row.title_en : locale === 'pt' ? row.title_pt || row.title_en : row.title_en;

  return (
    <>
      <FormSection
        id="changelog-form"
        title={editing ? ts('changelogEdit') : ts('changelogNew')}
        description={editing ? t('editTitle', { id: editing }) : undefined}
        footer={
          <>
            <p
              className="ui-section-note"
              role="status"
              aria-live="polite"
              data-tone={message ? (message.kind === 'error' ? 'error' : 'ok') : undefined}
            >
              {message ? message.text : ts('changelogNote')}
            </p>
            <div className="st-actions">
              {editing && (
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  {t('cancel')}
                </button>
              )}
              <button
                type="submit"
                form="st-cl-form"
                className="btn btn-primary"
                disabled={!draft.titleEn.trim()}
                aria-busy={busy || undefined}
              >
                {editing ? t('save') : draft.published ? t('publish') : t('save')}
              </button>
            </div>
          </>
        }
      >
        <form id="st-cl-form" className="st-cl-form" onSubmit={submit}>
          <div className="st-cl-top">
            <div className="ui-field">
              <label className="label" htmlFor="st-cl-date">
                {t('date')}
              </label>
              <input id="st-cl-date" className="input data" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} required />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="st-cl-title-en">
                {t('titleEn')}
              </label>
              <input
                id="st-cl-title-en"
                className="input"
                value={draft.titleEn}
                maxLength={200}
                required
                onChange={(e) => set('titleEn', e.target.value)}
              />
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="st-cl-body-en">
              {t('bodyEn')}
            </label>
            <textarea
              id="st-cl-body-en"
              className="textarea data"
              rows={6}
              value={draft.bodyEn}
              onChange={(e) => set('bodyEn', e.target.value)}
            />
          </div>

          <fieldset className="st-fieldset">
            <legend className="label">{t('products')}</legend>
            <div className="st-checks">
              {PRODUCT_KEYS.map((p) => (
                <label key={p} className="ui-check">
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

          <label className="ui-switch">
            <input type="checkbox" role="switch" checked={draft.published} onChange={(e) => set('published', e.target.checked)} />
            {t('publishedLabel')}
          </label>

          <AdvancedSection storageKey="settings.changelog.translations" label={ts('translations')} hint={ts('translationsHint')}>
            {(['Es', 'Pt'] as const).map((l) => (
              <div key={l} className="st-cl-lang">
                <div className="ui-field">
                  <label className="label" htmlFor={`st-cl-title-${l}`}>
                    {t(`title${l}`)}
                  </label>
                  <input
                    id={`st-cl-title-${l}`}
                    className="input"
                    value={draft[`title${l}`]}
                    maxLength={200}
                    onChange={(e) => set(`title${l}`, e.target.value)}
                  />
                </div>
                <div className="ui-field">
                  <label className="label" htmlFor={`st-cl-body-${l}`}>
                    {t(`body${l}`)}
                  </label>
                  <textarea
                    id={`st-cl-body-${l}`}
                    className="textarea data"
                    rows={4}
                    value={draft[`body${l}`]}
                    onChange={(e) => set(`body${l}`, e.target.value)}
                  />
                </div>
              </div>
            ))}
            <p className="ui-help">{t('bodyHint')}</p>
          </AdvancedSection>

          <AdvancedSection
            storageKey="settings.changelog.closes"
            label={ts('closes')}
            hint={ts('closesHint', { count: draft.closesItemIds.length })}
          >
            <div className="ui-field">
              <label className="sr-only" htmlFor="st-cl-closes">
                {t('closesSearch')}
              </label>
              <input
                id="st-cl-closes"
                className="input"
                type="search"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                placeholder={t('closesSearch')}
              />
            </div>
            <div className="st-cl-items">
              {visibleItems.length === 0 && <p className="ui-help">{t('closesEmpty')}</p>}
              {visibleItems.map((i) => (
                <label key={i.id} className="ui-check">
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
                  <span>
                    {i.title} <span className="st-muted">{i.status === 'proposed' ? t('triage') : tStatus(i.status)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="ui-help">{t('closesHint')}</p>
          </AdvancedSection>
        </form>
      </FormSection>

      <section className="st-block" aria-labelledby="st-cl-entries">
        <h2 className="st-block-title" id="st-cl-entries">
          {ts('entries')}
        </h2>
        <DataTable
          caption={ts('entries')}
          rows={entries}
          rowKey={(r) => r.id}
          compact
          className="st-table-stack"
          empty={<EmptyState quiet title={ts('changelogEmptyTitle')} body={ts('changelogEmptyBody')} />}
          columns={[
            { key: 'date', header: ts('colDate'), cell: (r) => r.date, data: true, width: '120px' },
            { key: 'title', header: ts('colTitle'), cell: (r) => <span className="st-strong">{titleFor(r)}</span> },
            {
              key: 'state',
              header: ts('colState'),
              cell: (r) =>
                r.published === 1 ? (
                  <span className="badge badge-ok">{ts('statePublished')}</span>
                ) : (
                  <span className="badge">{ts('stateDraft')}</span>
                ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">{ts('colActions')}</span>,
              cell: (r) => (
                <div className="st-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(r)} aria-label={`${t('edit')} ${titleFor(r)}`}>
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-danger btn-sm"
                    onClick={() => remove(r.id)}
                    aria-label={`${t('delete')} ${titleFor(r)}`}
                  >
                    {t('delete')}
                  </button>
                </div>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
