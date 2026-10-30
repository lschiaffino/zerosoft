'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { CollectionDto } from '@/lib/shop';
import { COLLECTION_FIELDS, COLLECTION_OPS, type CollectionRules } from '@/lib/shop-schema';
import { api, useErrorText, useToast } from './shop-ui';

type ProductOpt = { id: string; title: string; status: string; image: string | null };

/** Colección manual (elegir productos) o automática (reglas por etiqueta, tipo, marca, título o precio). */
export default function CollectionEditor({ collection, products, storeHandle }: { collection: CollectionDto | null; products: ProductOpt[]; storeHandle: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const isNew = !collection;
  const [title, setTitle] = useState(collection?.title ?? '');
  const [description, setDescription] = useState(collection?.description ?? '');
  const [kind, setKind] = useState<'manual' | 'auto'>(collection?.kind ?? 'manual');
  const [rules, setRules] = useState<CollectionRules>(collection?.rules ?? { match: 'all', rules: [{ field: 'tag', op: 'equals', value: '' }] });
  const [selected, setSelected] = useState<string[]>(collection?.kind === 'manual' ? collection.productIds : []);
  const [published, setPublished] = useState(collection?.published ?? true);
  const [featured, setFeatured] = useState(collection?.featured ?? false);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const shown = useMemo(() => products.filter((p) => p.title.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 200), [products, filter]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      title,
      description,
      kind,
      published,
      featured,
      ...(kind === 'auto' ? { rules: { ...rules, rules: rules.rules.filter((r) => r.value.trim()) } } : { productIds: selected }),
    };
    const res = isNew
      ? await api<{ collection?: CollectionDto }>('/api/shop/collections', { method: 'POST', json: body })
      : await api<{ collection?: CollectionDto }>(`/api/shop/collections/${collection!.id}`, { method: 'PATCH', json: body });
    setSaving(false);
    if (!res.ok || !res.data.collection) {
      push(errText(res.data.error), 'bad');
      return;
    }
    push(t('editor.saved'));
    if (isNew) router.replace(`/app/shop/collections/${res.data.collection.id}`);
    else router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/shop/collections/${collection!.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/shop/collections');
    router.refresh();
  };

  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        back={{ href: '/app/shop/collections', label: t('nav.collections') }}
        title={isNew ? t('collections.new') : collection!.title}
        actions={
          !isNew &&
          collection!.published && (
            <a className="btn btn-secondary" href={`/store/${storeHandle}/collections/${collection!.handle}`} target="_blank" rel="noreferrer">
              {t('editor.viewInStore')}
            </a>
          )
        }
      />
      <form className="shop-editor" onSubmit={save}>
        <div className="shop-editor-main">
          <section className="panel shop-panel">
            <label className="ui-field">
              <span className="label">{t('editor.title')}</span>
              <input className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.description')}</span>
              <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </section>
          <section className="panel shop-panel">
            <fieldset className="ui-field shop-fieldset">
              <legend className="label">{t('collections.type')}</legend>
              <label className="ui-check">
                <input type="radio" name="kind" checked={kind === 'manual'} onChange={() => setKind('manual')} />
                <span>{t('collections.manualHelp')}</span>
              </label>
              <label className="ui-check">
                <input type="radio" name="kind" checked={kind === 'auto'} onChange={() => setKind('auto')} />
                <span>{t('collections.autoHelp')}</span>
              </label>
            </fieldset>
            {kind === 'auto' ? (
              <div>
                <label className="ui-field">
                  <span className="label">{t('collections.match')}</span>
                  <select className="select" value={rules.match} onChange={(e) => setRules({ ...rules, match: e.target.value as 'all' | 'any' })}>
                    <option value="all">{t('collections.matchAll')}</option>
                    <option value="any">{t('collections.matchAny')}</option>
                  </select>
                </label>
                {rules.rules.map((r, i) => (
                  <div key={i} className="shop-option-row">
                    <select
                      className="select"
                      aria-label={t('collections.field')}
                      value={r.field}
                      onChange={(e) => setRules({ ...rules, rules: rules.rules.map((x, j) => (j === i ? { ...x, field: e.target.value as typeof r.field } : x)) })}
                    >
                      {COLLECTION_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {t(`collections.fields.${f}`)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select"
                      aria-label={t('collections.op')}
                      value={r.op}
                      onChange={(e) => setRules({ ...rules, rules: rules.rules.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof r.op } : x)) })}
                    >
                      {COLLECTION_OPS.map((o) => (
                        <option key={o} value={o}>
                          {t(`collections.ops.${o}`)}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      aria-label={t('collections.value')}
                      value={r.value}
                      onChange={(e) => setRules({ ...rules, rules: rules.rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                    />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRules({ ...rules, rules: rules.rules.filter((_, j) => j !== i) })}>
                      {t('editor.remove')}
                    </button>
                  </div>
                ))}
                {rules.rules.length < 20 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRules({ ...rules, rules: [...rules.rules, { field: 'tag', op: 'equals', value: '' }] })}>
                    {t('collections.addRule')}
                  </button>
                )}
                {!isNew && collection!.kind === 'auto' && <p className="ui-help">{t('collections.matches', { n: collection!.productCount })}</p>}
              </div>
            ) : (
              <div>
                <input className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('products.search')} aria-label={t('products.search')} />
                <ul className="shop-pick">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <label className="ui-check">
                        <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))} />
                        <span>{p.title}</span>
                        {p.status !== 'active' && <span className="shop-rowmeta"> · {t(`productStatus.${p.status}`)}</span>}
                      </label>
                    </li>
                  ))}
                  {products.length === 0 && <li className="ui-help">{t('collections.noProducts')}</li>}
                </ul>
                <p className="ui-help">{t('collections.selected', { n: selected.length })}</p>
              </div>
            )}
          </section>
        </div>
        <aside className="shop-editor-side">
          <section className="panel shop-panel">
            <label className="ui-check">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              <span>{t('collections.publishedLabel')}</span>
            </label>
            <label className="ui-check">
              <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
              <span>{t('collections.featuredLabel')}</span>
            </label>
          </section>
          <div className="shop-editor-actions">
            <button type="submit" className="btn btn-primary btn-block" aria-busy={saving} disabled={saving}>
              {isNew ? t('collections.create') : t('editor.save')}
            </button>
            {!isNew && (
              <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirm(true)}>
                {t('editor.delete')}
              </button>
            )}
          </div>
        </aside>
      </form>
      <ConfirmDialog
        open={confirm}
        danger
        title={t('collections.deleteTitle', { title: collection?.title ?? '' })}
        body={t('collections.deleteBody')}
        confirmLabel={t('editor.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
      {toast}
    </div>
  );
}
