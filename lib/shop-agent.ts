/**
 * Shop para Agents: estado de un pedido por número + email (los dos tienen
 * que coincidir, como la página de estado de la tienda). Sin coincidencia
 * no dice si el número existe. Mismo formato que la consulta de Shopify.
 */
import { getStore } from './shop';
import { lookupOrder, orderItems } from './shop-orders';
import { formatMoney } from './shop-money';

export async function shopOrderStatus(ws: string, orderNumber: string, email: string): Promise<Record<string, unknown>> {
  const number = orderNumber.replace(/^#/, '').trim();
  if (!/^\d{1,9}$/.test(number)) return { error: 'invalid_order_number' };
  const store = await getStore(ws);
  if (!store) return { error: 'shop_not_set_up' };
  const o = await lookupOrder(store, number, email);
  if (!o) return { found: false };
  const items = await orderItems(o.id);
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  return {
    found: true,
    order: {
      name: `#${o.number}`,
      createdAt: o.created_at.slice(0, 10),
      status: o.status,
      paid: Boolean(o.paid_at),
      fulfilled: o.status === 'fulfilled',
      cancelled: o.status === 'cancelled',
      total: formatMoney(o.total_cents, o.currency),
      items: items.slice(0, 10).map((i) => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} x${i.quantity}`),
      statusUrl: `${base}/store/${store.handle}/orders/${o.status_token}`,
    },
    shipments: o.tracking_number ? [{ company: o.tracking_company, trackingNumber: o.tracking_number, trackingUrl: o.tracking_url }] : [],
  };
}
