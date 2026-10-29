'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/shop-money';
import type { PublicProduct } from '@/lib/shop-storefront';
import type { StorefrontStrings } from '@/lib/shop-i18n';
import { addToCart } from './cart-store';

/** Ficha del producto: fotos, opciones, precio, stock y "agregar al carrito". */
export default function ProductView({
  handle,
  product,
  currency,
  locale,
  t,
}: {
  handle: string;
  product: PublicProduct;
  currency: string;
  locale: string;
  t: StorefrontStrings;
}) {
  const firstAvailable = product.variants.find((v) => v.available) ?? product.variants[0];
  const [selected, setSelected] = useState<string[]>(firstAvailable?.options ?? []);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const variant = useMemo(
    () => (product.options.length ? product.variants.find((v) => v.options.every((o, i) => o === selected[i])) : product.variants[0]) ?? null,
    [product, selected],
  );
  const images = product.images.length ? product.images : [];
  const [imgIdx, setImgIdx] = useState(0);
  const shown = variant?.imageUrl ?? images[imgIdx] ?? null;
  const money = (c: number) => formatMoney(c, currency, locale);

  const add = () => {
    if (!variant || !variant.available) return;
    addToCart(handle, variant.id, qty);
    setAdded(true);
  };

  return (
    <div className="sf-product">
      <div className="sf-gallery">
        <div className="sf-gallery-main">{shown ? <img src={shown} alt={product.title} /> : <span className="sf-card-ph" aria-hidden="true" />}</div>
        {images.length > 1 && (
          <div className="sf-thumbs" role="list">
            {images.map((src, i) => (
              <button key={src} type="button" role="listitem" className={`sf-thumb${i === imgIdx && !variant?.imageUrl ? ' is-active' : ''}`} onClick={() => setImgIdx(i)} aria-label={`${t.image} ${i + 1}`}>
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="sf-info">
        {product.vendor && <p className="sf-vendor">{product.vendor}</p>}
        <h1 className="sf-title">{product.title}</h1>
        <p className="sf-price" data-testid="sf-price">
          {variant ? money(variant.priceCents) : ''}
          {variant?.compareAtCents != null && variant.compareAtCents > variant.priceCents && <s>{money(variant.compareAtCents)}</s>}
        </p>
        {product.options.map((o, i) => (
          <fieldset key={o.name} className="sf-option">
            <legend>{o.name}</legend>
            <div className="sf-option-values">
              {o.values.map((v) => {
                const next = [...selected];
                next[i] = v;
                const match = product.variants.find((pv) => pv.options.every((x, j) => x === next[j]));
                const unavailable = !match || !match.available;
                return (
                  <button
                    key={v}
                    type="button"
                    className={`sf-chip${selected[i] === v ? ' is-active' : ''}${unavailable ? ' is-out' : ''}`}
                    aria-pressed={selected[i] === v}
                    onClick={() => {
                      setSelected(next);
                      setAdded(false);
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        {variant && !variant.available && <p className="sf-stock sf-stock-out">{t.soldOut}</p>}
        {variant?.low && <p className="sf-stock">{t.lowStock}</p>}
        <div className="sf-buy">
          <label className="sf-qty">
            <span className="sf-sr">{t.quantity}</span>
            <input type="number" min={1} max={99} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
          </label>
          <button type="button" className="sf-btn sf-btn-primary" onClick={add} disabled={!variant || !variant.available}>
            {variant && !variant.available ? t.soldOut : t.addToCart}
          </button>
        </div>
        {added && (
          <p className="sf-added" role="status">
            {t.added} <Link href={`/store/${handle}/cart`}>{t.viewCart}</Link>
          </p>
        )}
        {product.descriptionHtml && <div className="sf-desc" dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />}
      </div>
    </div>
  );
}
