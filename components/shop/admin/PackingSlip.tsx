'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { OrderDto } from '@/lib/shop-orders';
import type { StoreDto } from '@/lib/shop';
import { useDate } from './shop-ui';

/** Remito para imprimir: tienda, pedido, dirección e ítems (sin precios). */
export default function PackingSlip({ order, store }: { order: OrderDto; store: StoreDto }) {
  const t = useTranslations('shop');
  const date = useDate();
  const a = order.shippingAddress;
  return (
    <div className="app-page ui-page shop-slip-page">
      <div className="shop-slip-tools">
        <Link className="btn btn-secondary" href={`/app/shop/orders/${order.id}`}>
          {t('order.backToOrder')}
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          {t('order.print')}
        </button>
      </div>
      <article className="shop-slip">
        <header className="shop-slip-head">
          <div>
            {store.brand.logoUrl ? <img src={store.brand.logoUrl} alt={store.name} className="shop-slip-logo" /> : <strong>{store.name}</strong>}
            {store.contactEmail && <p>{store.contactEmail}</p>}
          </div>
          <div className="shop-slip-meta">
            <h1>{t('order.packingSlip')}</h1>
            <p>{t('order.title', { n: order.number })}</p>
            <p>{date(order.createdAt, false)}</p>
          </div>
        </header>
        {a && (
          <section>
            <h2>{t('order.shipTo')}</h2>
            <address>
              {a.name}
              <br />
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ''}
              <br />
              {[a.city, a.region, a.postalCode].filter(Boolean).join(', ')}
              <br />
              {a.country}
              {a.phone ? (
                <>
                  <br />
                  {a.phone}
                </>
              ) : null}
            </address>
          </section>
        )}
        <table className="shop-slip-table">
          <thead>
            <tr>
              <th scope="col">{t('order.item')}</th>
              <th scope="col">{t('editor.sku')}</th>
              <th scope="col">{t('order.qty')}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.title}
                  {i.variantTitle ? ` (${i.variantTitle})` : ''}
                </td>
                <td>{i.sku}</td>
                <td>{i.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {order.note && (
          <p>
            <strong>{t('order.customerNote')}:</strong> {order.note}
          </p>
        )}
        <p className="shop-slip-thanks">{t('order.slipThanks')}</p>
      </article>
    </div>
  );
}
