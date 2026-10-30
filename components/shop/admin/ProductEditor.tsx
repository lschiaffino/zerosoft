'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { InventoryLogDto, LocationDto, ProductDto } from '@/lib/shop';
import { optionCombos, type ProductOption } from '@/lib/shop-schema';
import { MoneyInput, ShopDialog, StatusBadge, api, useDate, useErrorText, useMoney, useToast } from './shop-ui';

interface VariantDraft {
  key: string;
  id?: string;
  options: string[];
  sku: string;
  barcode: string;
  priceCents: number | null;
  compareAtCents: number | null;
  weightGrams: number;
  trackInventory: boolean;
  initialStock: number;
  stock: number;
  inventory: Array<{ locationId: string; available: number; reserved: number }>;
}

const comboKey = (values: string[]) => values.map((v) => v.trim().toLowerCase()).join('|');

function draftFrom(product: ProductDto | null): VariantDraft[] {
  if (!product) return [{ key: 'v0', options: [], sku: '', barcode: '', priceCents: null, compareAtCents: null, weightGrams: 0, trackInventory: true, initialStock: 0, stock: 0, inventory: [] }];
  return product.variants.map((v) => ({
    key: v.id,
    id: v.id,
    options: v.options,
    sku: v.sku,
    barcode: v.barcode,
    priceCents: v.priceCents,
    compareAtCents: v.compareAtCents,
    weightGrams: v.weightGrams,
    trackInventory: v.trackInventory,
    initialStock: 0,
    stock: v.stock,
    inventory: v.inventory,
  }));
}

/** Editor de producto: datos, fotos, opciones y variantes, stock, colecciones y SEO. */
export default function ProductEditor({
  product,
  currency,
  locations,
  collections,
  storeHandle,
  published,
  history = [],
}: {
  product: ProductDto | null;
  currency: string;
  locations: LocationDto[];
  collections: Array<{ id: string; title: string }>;
  storeHandle: string;
  published: boolean;
  history?: InventoryLogDto[];
}) {
  const t = useTranslations('shop');
  const router = useRouter();
  const money = useMoney(currency);
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const isNew = !product;
  const [title, setTitle] = useState(product?.title ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [status, setStatus] = useState(product?.status ?? 'active');
  const [vendor, setVendor] = useState(product?.vendor ?? '');
  const [productType, setProductType] = useState(product?.productType ?? '');
  const [tags, setTags] = useState((product?.tags ?? []).join(', '));
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [handle, setHandle] = useState(product?.handle ?? '');
  const [seoTitle, setSeoTitle] = useState(product?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(product?.seoDescription ?? '');
  const [requiresShipping, setRequiresShipping] = useState(product?.requiresShipping ?? true);
  const [collectionIds, setCollectionIds] = useState<string[]>(product?.collectionIds ?? []);
  const [options, setOptions] = useState<Array<{ name: string; values: string }>>((product?.options ?? []).map((o) => ({ name: o.name, values: o.values.join(', ') })));
  const [variants, setVariants] = useState<VariantDraft[]>(draftFrom(product));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [adjust, setAdjust] = useState<{ variant: VariantDraft; locationId: string; value: string } | null>(null);
  const [share, setShare] = useState<{ open: boolean; source: string; medium: string; campaign: string; result: string | null }>({ open: false, source: '', medium: '', campaign: '', result: null });
  const fileRef = useRef<HTMLInputElement>(null);

  const parsedOptions: ProductOption[] = useMemo(
    () =>
      options
        .map((o) => ({ name: o.name.trim(), values: o.values.split(',').map((v) => v.trim()).filter((v, i, a) => v && a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i) }))
        .filter((o) => o.name && o.values.length),
    [options],
  );

  /** Al cambiar las opciones: una variante por combinación, conservando las que ya estaban. */
  const syncVariants = (next: Array<{ name: string; values: string }>) => {
    setOptions(next);
    const opts = next
      .map((o) => ({ name: o.name.trim(), values: o.values.split(',').map((v) => v.trim()).filter(Boolean) }))
      .filter((o) => o.name && o.values.length);
    setVariants((cur) => {
      const base = cur[0];
      if (!opts.length) return [cur.find((v) => v.options.length === 0) ?? { ...base, key: 'v0', id: base?.options.length ? undefined : base?.id, options: [] }];
      return optionCombos(opts).map((combo) => {
        const found = cur.find((v) => comboKey(v.options) === comboKey(combo));
        return (
          found ?? {
            key: `n-${comboKey(combo)}`,
            options: combo,
            sku: '',
            barcode: '',
            priceCents: base?.priceCents ?? null,
            compareAtCents: base?.compareAtCents ?? null,
            weightGrams: base?.weightGrams ?? 0,
            trackInventory: base?.trackInventory ?? true,
            initialStock: 0,
            stock: 0,
            inventory: [],
          }
        );
      });
    });
  };

  const setVariant = (key: string, patch: Partial<VariantDraft>) => setVariants((cur) => cur.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files).slice(0, 10)) {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/shop/images', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) setImages((cur) => [...cur, data.url!]);
      else push(errText(data.error), 'bad');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (variants.some((v) => v.priceCents == null)) {
      push(t('editor.priceRequired'), 'bad');
      return;
    }
    setSaving(true);
    const body = {
      title,
      description,
      status,
      vendor,
      productType,
      tags: tags.split(',').map((x) => x.trim()).filter(Boolean),
      images,
      ...(handle.trim() ? { handle: handle.trim() } : {}),
      seoTitle,
      seoDescription,
      requiresShipping,
      collectionIds,
      options: parsedOptions,
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        options: v.options,
        sku: v.sku,
        barcode: v.barcode,
        priceCents: v.priceCents ?? 0,
        compareAtCents: v.compareAtCents,
        weightGrams: v.weightGrams,
        trackInventory: v.trackInventory,
        ...(!v.id && v.initialStock > 0 ? { initialStock: v.initialStock } : {}),
      })),
    };
    const res = isNew
      ? await api<{ product?: ProductDto }>('/api/shop/products', { method: 'POST', json: body })
      : await api<{ product?: ProductDto }>(`/api/shop/products/${product!.id}`, { method: 'PATCH', json: body });
    setSaving(false);
    if (!res.ok || !res.data.product) {
      push(errText(res.data.error), 'bad');
      return;
    }
    push(t('editor.saved'));
    if (isNew) router.replace(`/app/shop/products/${res.data.product.id}`);
    else {
      setVariants(draftFrom(res.data.product));
      setHandle(res.data.product.handle);
      router.refresh();
    }
  };

  const remove = async () => {
    const res = await api(`/api/shop/products/${product!.id}`, { method: 'DELETE' });
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      setConfirmDelete(false);
      return;
    }
    router.replace('/app/shop/products');
    router.refresh();
  };

  const saveAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjust?.variant.id) return;
    const value = Number(adjust.value);
    if (!Number.isInteger(value) || value < 0) return;
    const res = await api<{ level?: { available: number } }>('/api/shop/inventory', {
      method: 'POST',
      json: { variantId: adjust.variant.id, locationId: adjust.locationId, set: value, reason: 'count' },
    });
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      return;
    }
    setAdjust(null);
    push(t('inventory.saved'));
    const fresh = await api<{ product?: ProductDto }>(`/api/shop/products/${product!.id}`);
    if (fresh.data.product) setVariants(draftFrom(fresh.data.product));
    router.refresh();
  };

  const createShare = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api<{ link?: { shortUrl: string } }>('/api/shop/share-link', {
      method: 'POST',
      json: { kind: 'product', id: product!.id, utmSource: share.source, utmMedium: share.medium, utmCampaign: share.campaign },
    });
    if (!res.ok || !res.data.link) {
      push(errText(res.data.error), 'bad');
      return;
    }
    setShare((s) => ({ ...s, result: res.data.link!.shortUrl }));
  };

  const storeUrl = `/store/${storeHandle}/products/${product?.handle ?? ''}`;
  const single = parsedOptions.length === 0;
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? '';

  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        back={{ href: '/app/shop/products', label: t('nav.products') }}
        title={isNew ? t('products.new') : product!.title}
        actions={
          !isNew && (
            <>
              {published && product!.status === 'active' && (
                <a className="btn btn-secondary" href={storeUrl} target="_blank" rel="noreferrer">
                  {t('editor.viewInStore')}
                </a>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setShare((s) => ({ ...s, open: true, result: null }))}>
                {t('editor.shareLink')}
              </button>
            </>
          )
        }
      />
      <form className="shop-editor" onSubmit={save}>
        <div className="shop-editor-main">
          <section className="panel shop-panel">
            <label className="ui-field">
              <span className="label">{t('editor.title')}</span>
              <input className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} name="title" />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.description')}</span>
              <textarea className="textarea" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} name="description" />
              <span className="ui-help">{t('editor.descriptionHelp')}</span>
            </label>
          </section>

          <section className="panel shop-panel" aria-labelledby="shop-media">
            <h2 className="shop-panel-title" id="shop-media">
              {t('editor.media')}
            </h2>
            <div className="shop-media">
              {images.map((src, i) => (
                <figure key={src} className="shop-media-item">
                  <img src={src} alt="" />
                  <figcaption className="shop-media-actions">
                    {i > 0 && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImages((cur) => [cur[i], ...cur.filter((_, j) => j !== i)])}>
                        {t('editor.makeMain')}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} aria-label={t('editor.removeImage')}>
                      {t('editor.remove')}
                    </button>
                  </figcaption>
                </figure>
              ))}
              <label className="shop-media-add">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} />
                <span>{uploading ? t('editor.uploading') : t('editor.addImages')}</span>
              </label>
            </div>
          </section>

          <section className="panel shop-panel" aria-labelledby="shop-options">
            <h2 className="shop-panel-title" id="shop-options">
              {t('editor.options')}
            </h2>
            <p className="ui-help">{t('editor.optionsHelp')}</p>
            {options.map((o, i) => (
              <div key={i} className="shop-option-row">
                <input
                  className="input"
                  aria-label={t('editor.optionName')}
                  placeholder={t('editor.optionNamePh')}
                  value={o.name}
                  onChange={(e) => syncVariants(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <input
                  className="input"
                  aria-label={t('editor.optionValues')}
                  placeholder={t('editor.optionValuesPh')}
                  value={o.values}
                  onChange={(e) => syncVariants(options.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => syncVariants(options.filter((_, j) => j !== i))}>
                  {t('editor.remove')}
                </button>
              </div>
            ))}
            {options.length < 3 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOptions([...options, { name: '', values: '' }])}>
                {t('editor.addOption')}
              </button>
            )}
          </section>

          <section className="panel shop-panel" aria-labelledby="shop-variants">
            <h2 className="shop-panel-title" id="shop-variants">
              {single ? t('editor.pricing') : t('editor.variants', { n: variants.length })}
            </h2>
            <div className="table-wrap">
              <table className="table table-compact shop-variants">
                <thead>
                  <tr>
                    {!single && <th scope="col">{t('editor.variant')}</th>}
                    <th scope="col">{t('editor.price')}</th>
                    <th scope="col">{t('editor.compareAt')}</th>
                    <th scope="col">{t('editor.sku')}</th>
                    <th scope="col">{t('editor.barcode')}</th>
                    <th scope="col">{t('editor.weight')}</th>
                    <th scope="col">{t('editor.stock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.key}>
                      {!single && <th scope="row">{v.options.join(' / ')}</th>}
                      <td>
                        <MoneyInput id={`price-${v.key}`} label={t('editor.price')} value={v.priceCents} onChange={(c) => setVariant(v.key, { priceCents: c })} required />
                      </td>
                      <td>
                        <MoneyInput id={`cmp-${v.key}`} label={t('editor.compareAt')} value={v.compareAtCents} onChange={(c) => setVariant(v.key, { compareAtCents: c })} />
                      </td>
                      <td>
                        <input className="input" aria-label={t('editor.sku')} value={v.sku} maxLength={80} onChange={(e) => setVariant(v.key, { sku: e.target.value })} />
                      </td>
                      <td>
                        <input className="input" aria-label={t('editor.barcode')} value={v.barcode} maxLength={80} onChange={(e) => setVariant(v.key, { barcode: e.target.value })} />
                      </td>
                      <td>
                        <input
                          className="input shop-num-input"
                          type="number"
                          min={0}
                          aria-label={t('editor.weight')}
                          value={v.weightGrams}
                          onChange={(e) => setVariant(v.key, { weightGrams: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        />
                      </td>
                      <td>
                        <div className="shop-stock-cell">
                          <label className="ui-check shop-track">
                            <input type="checkbox" checked={v.trackInventory} onChange={(e) => setVariant(v.key, { trackInventory: e.target.checked })} />
                            <span>{t('editor.track')}</span>
                          </label>
                          {v.trackInventory &&
                            (v.id ? (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdjust({ variant: v, locationId: locations[0]?.id ?? '', value: String(v.inventory.find((x) => x.locationId === locations[0]?.id)?.available ?? 0) })}>
                                {t('editor.inStock', { n: v.stock })}
                              </button>
                            ) : (
                              <input
                                className="input shop-num-input"
                                type="number"
                                min={0}
                                aria-label={t('editor.initialStock')}
                                value={v.initialStock}
                                onChange={(e) => setVariant(v.key, { initialStock: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                              />
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ui-help">{t('editor.weightHelp', { currency })}</p>
          </section>

          {!isNew && history.length > 0 && (
            <section className="panel shop-panel" aria-labelledby="shop-history">
              <h2 className="shop-panel-title" id="shop-history">
                {t('inventory.history')}
              </h2>
              <ul className="shop-timeline">
                {history.slice(0, 10).map((h) => (
                  <li key={h.id}>
                    <span className="data">{h.delta > 0 ? `+${h.delta}` : h.delta}</span> {h.variantTitle !== 'Default' ? `${h.variantTitle} · ` : ''}
                    {t(`inventory.reasons.${h.reason}`)} · {h.locationName} · {date(h.createdAt)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="shop-editor-side">
          <section className="panel shop-panel">
            <label className="ui-field">
              <span className="label">{t('editor.status')}</span>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {['active', 'draft', 'archived'].map((s) => (
                  <option key={s} value={s}>
                    {t(`productStatus.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            {!isNew && <StatusBadge status={product!.status} kind="product" />}
            {status === 'active' && !published && <p className="ui-help">{t('editor.storeUnpublished')}</p>}
          </section>
          <section className="panel shop-panel">
            <h2 className="shop-panel-title">{t('editor.organization')}</h2>
            <label className="ui-field">
              <span className="label">{t('editor.vendor')}</span>
              <input className="input" value={vendor} maxLength={120} onChange={(e) => setVendor(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.type')}</span>
              <input className="input" value={productType} maxLength={120} onChange={(e) => setProductType(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.tags')}</span>
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('editor.tagsPh')} />
            </label>
            {collections.length > 0 && (
              <fieldset className="ui-field shop-fieldset">
                <legend className="label">{t('nav.collections')}</legend>
                {collections.map((c) => (
                  <label key={c.id} className="ui-check">
                    <input
                      type="checkbox"
                      checked={collectionIds.includes(c.id)}
                      onChange={(e) => setCollectionIds((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
                    />
                    <span>{c.title}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <label className="ui-check">
              <input type="checkbox" checked={requiresShipping} onChange={(e) => setRequiresShipping(e.target.checked)} />
              <span>{t('editor.requiresShipping')}</span>
            </label>
          </section>
          <section className="panel shop-panel">
            <h2 className="shop-panel-title">{t('editor.seo')}</h2>
            <label className="ui-field">
              <span className="label">{t('editor.handle')}</span>
              <input className="input" value={handle} maxLength={64} onChange={(e) => setHandle(e.target.value)} placeholder={t('editor.handlePh')} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.seoTitle')}</span>
              <input className="input" value={seoTitle} maxLength={120} onChange={(e) => setSeoTitle(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.seoDescription')}</span>
              <textarea className="textarea" rows={3} value={seoDescription} maxLength={320} onChange={(e) => setSeoDescription(e.target.value)} />
            </label>
          </section>
          <div className="shop-editor-actions">
            <button type="submit" className="btn btn-primary btn-block" aria-busy={saving} disabled={saving}>
              {isNew ? t('editor.create') : t('editor.save')}
            </button>
            {!isNew && (
              <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
                {t('editor.delete')}
              </button>
            )}
          </div>
        </aside>
      </form>

      <ShopDialog open={!!adjust} title={t('inventory.adjustTitle')} onClose={() => setAdjust(null)}>
        {adjust && (
          <form onSubmit={saveAdjust}>
            <div className="ui-modal-body">
              <p>{adjust.variant.options.join(' / ') || product?.title}</p>
              <label className="ui-field">
                <span className="label">{t('inventory.location')}</span>
                <select
                  className="select"
                  value={adjust.locationId}
                  onChange={(e) =>
                    setAdjust({ ...adjust, locationId: e.target.value, value: String(adjust.variant.inventory.find((x) => x.locationId === e.target.value)?.available ?? 0) })
                  }
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('inventory.available')}</span>
                <input className="input" type="number" min={0} required autoFocus value={adjust.value} onChange={(e) => setAdjust({ ...adjust, value: e.target.value })} />
              </label>
              {adjust.variant.inventory
                .filter((x) => x.reserved > 0)
                .map((x) => (
                  <p key={x.locationId} className="ui-help">
                    {t('inventory.reservedAt', { n: x.reserved, location: locName(x.locationId) })}
                  </p>
                ))}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setAdjust(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </ShopDialog>

      <ShopDialog open={share.open} title={t('editor.shareLink')} onClose={() => setShare((s) => ({ ...s, open: false }))}>
        <form onSubmit={createShare}>
          <div className="ui-modal-body">
            <p className="ui-help">{t('editor.shareHelp')}</p>
            {(['source', 'medium', 'campaign'] as const).map((k) => (
              <label key={k} className="ui-field">
                <span className="label">utm_{k}</span>
                <input className="input" value={share[k]} maxLength={100} onChange={(e) => setShare((s) => ({ ...s, [k]: e.target.value }))} />
              </label>
            ))}
            {share.result && (
              <p className="shop-share-result" role="status">
                <span className="data">{share.result}</span>
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-secondary" onClick={() => setShare((s) => ({ ...s, open: false }))}>
              {t('common.close')}
            </button>
            {share.result ? (
              <button type="button" className="btn btn-primary" onClick={() => void navigator.clipboard?.writeText(share.result!).then(() => push(t('common.copied')))}>
                {t('common.copy')}
              </button>
            ) : (
              <button type="submit" className="btn btn-primary">
                {t('editor.createLink')}
              </button>
            )}
          </div>
        </form>
      </ShopDialog>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('editor.deleteTitle', { title: product?.title ?? '' })}
        body={t('editor.deleteBody')}
        confirmLabel={t('editor.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      {toast}
      {!isNew && (
        <p className="ui-help shop-foot">
          <Link href={`/app/shop/inventory?q=${encodeURIComponent(product!.title)}`}>{t('editor.seeInventory')}</Link> · {money(product!.variants[0]?.priceCents ?? 0)}
        </p>
      )}
    </div>
  );
}
