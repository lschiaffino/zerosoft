/**
 * Herramientas de Shop para el asistente. Lectura: pedidos, productos,
 * stock bajo y ventas. Escritura (con confirmación): crear un producto,
 * marcar un pedido como enviado y crear un código de descuento. Todas con
 * las mismas funciones que la app (lib/shop*.ts) y solo para quien tiene Shop.
 */
import { z } from 'zod';
import { createDiscount, createProduct, ensureStore, listInventory, listProducts } from '../shop';
import { fulfillOrder, getOrder, listOrders, shopAnalytics } from '../shop-orders';
import { formatMoney } from '../shop-money';
import { getDb } from '../db';
import type { ShopActor } from '../shop-schema';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

const actor = (ctx: ToolCtx): ShopActor => ({ ws: ctx.workspaceId, person: ctx.personId, admin: ctx.isAdmin });

async function orderIdByNumber(ws: string, number: number): Promise<string | null> {
  const row = (await getDb().prepare('SELECT id FROM shop_orders WHERE workspace_id = ? AND number = ?').get(ws, number)) as { id: string } | undefined;
  return row?.id ?? null;
}

export const shopTools: AssistantTool[] = [
  readTool({
    name: 'shop_orders',
    app: 'shop',
    description: 'List Shop orders, newest first. Filter by status (pending, paid, fulfilled, cancelled, refunded) or search by order number, email or name.',
    input: z.object({ status: z.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']).optional(), query: z.string().trim().max(200).optional() }),
    run: async (ctx, { status, query }) => {
      const store = await ensureStore(ctx.workspaceId);
      const res = await listOrders(ctx.workspaceId, { status, q: query, limit: 25 });
      return {
        total: res.total,
        orders: res.items.map((o) => ({
          number: o.number,
          status: o.status,
          customer: o.name || o.email,
          total: formatMoney(o.totalCents, store.currency),
          createdAt: o.createdAt,
          href: `/app/shop/orders/${o.id}`,
        })),
      };
    },
  }),
  readTool({
    name: 'shop_order',
    app: 'shop',
    description: 'One Shop order by its number: items, totals, status, shipping address and tracking.',
    input: z.object({ number: z.number().int().min(1).max(999_999_999) }),
    run: async (ctx, { number }) => {
      const id = await orderIdByNumber(ctx.workspaceId, number);
      const o = id ? await getOrder(ctx.workspaceId, id) : null;
      if (!o) return { error: 'not_found' };
      const money = (c: number) => formatMoney(c, o.currency);
      return {
        number: o.number,
        status: o.status,
        email: o.email,
        name: o.name,
        items: o.items.map((i) => ({ title: i.title, variant: i.variantTitle, quantity: i.quantity, total: money(i.totalCents) })),
        subtotal: money(o.subtotalCents),
        discount: o.discountCents ? `${money(o.discountCents)} (${o.discountCode})` : null,
        shipping: money(o.shippingCents),
        tax: money(o.taxCents),
        total: money(o.totalCents),
        paymentMethod: o.paymentMethod,
        tracking: o.tracking,
        createdAt: o.createdAt,
        href: `/app/shop/orders/${o.id}`,
      };
    },
  }),
  readTool({
    name: 'shop_products',
    app: 'shop',
    description: 'Search Shop products by name, SKU or tag: status, price range, variants and stock.',
    input: z.object({ query: z.string().trim().max(200).optional(), status: z.enum(['active', 'draft', 'archived']).optional() }),
    run: async (ctx, { query, status }) => {
      const store = await ensureStore(ctx.workspaceId);
      const res = await listProducts(ctx.workspaceId, { q: query, status, limit: 25 });
      return {
        total: res.total,
        products: res.items.map((p) => ({
          title: p.title,
          status: p.status,
          price: p.minPriceCents === p.maxPriceCents ? formatMoney(p.minPriceCents, store.currency) : `${formatMoney(p.minPriceCents, store.currency)} to ${formatMoney(p.maxPriceCents, store.currency)}`,
          variants: p.variants,
          stock: p.tracked ? p.stock : 'not tracked',
          href: `/app/shop/products/${p.id}`,
        })),
      };
    },
  }),
  readTool({
    name: 'shop_low_stock',
    app: 'shop',
    description: 'Shop variants at or below the low-stock threshold, per location.',
    input: z.object({}),
    run: async (ctx) => {
      const rows = await listInventory(ctx.workspaceId, { lowOnly: true });
      return {
        items: rows.slice(0, 50).map((r) => ({
          product: r.productTitle,
          variant: r.variantTitle,
          sku: r.sku,
          location: r.locationName,
          available: r.available - r.reserved,
          href: `/app/shop/products/${r.productId}`,
        })),
      };
    },
  }),
  readTool({
    name: 'shop_sales',
    app: 'shop',
    description: 'Shop sales summary for the last N days (7, 30, 90 or 365): sales, orders, average order, conversion and top products.',
    input: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).optional() }),
    run: async (ctx, { days }) => {
      const a = await shopAnalytics(ctx.workspaceId, days ?? 30);
      return {
        days: a.days,
        sales: formatMoney(a.salesCents, a.currency),
        orders: a.orders,
        averageOrder: formatMoney(a.aovCents, a.currency),
        conversion: a.conversion == null ? null : `${(a.conversion * 100).toFixed(1)}%`,
        visits: a.views,
        topProducts: a.topProducts.map((p) => ({ title: p.title, quantity: p.quantity, sales: formatMoney(p.salesCents, a.currency) })),
        href: `/app/shop/analytics?days=${a.days}`,
      };
    },
  }),
  writeTool({
    name: 'propose_shop_product',
    app: 'shop',
    description: 'Prepare a new Shop product with one price (in the store currency, e.g. 19.99), optional SKU and stock. Created as a draft unless active is true. The person confirms before it is created.',
    input: z.object({
      title: z.string().trim().min(1).max(200),
      price: z.number().min(0).max(10_000_000),
      sku: z.string().trim().max(80).optional(),
      stock: z.number().int().min(0).max(1_000_000).optional(),
      active: z.boolean().optional(),
    }),
    prepare: async (ctx, input) => {
      const store = await ensureStore(ctx.workspaceId);
      return {
        summary: `Create product "${input.title}"`,
        details: [
          { label: 'Title', after: input.title },
          { label: 'Price', after: formatMoney(Math.round(input.price * 100), store.currency) },
          ...(input.sku ? [{ label: 'SKU', after: input.sku }] : []),
          { label: 'Stock', after: String(input.stock ?? 0) },
          { label: 'Status', after: input.active ? 'Active' : 'Draft' },
        ],
        input: { ...input },
      };
    },
    execute: async (ctx, input) => {
      const p = await createProduct(actor(ctx), {
        title: String(input.title),
        status: input.active ? 'active' : 'draft',
        variants: [{ options: [], sku: String(input.sku ?? ''), priceCents: Math.round(Number(input.price) * 100), initialStock: Number(input.stock ?? 0) || undefined }],
      }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'error' }));
      if ('error' in p) return { ok: false, error: p.error };
      return { ok: true, message: `Product "${p.title}" created.`, href: `/app/shop/products/${p.id}` };
    },
  }),
  writeTool({
    name: 'propose_shop_fulfill',
    app: 'shop',
    description: 'Prepare marking a paid Shop order as fulfilled, with an optional tracking number and carrier. The customer gets the shipping email. The person confirms first.',
    input: z.object({ number: z.number().int().min(1), trackingNumber: z.string().trim().max(80).optional(), carrier: z.string().trim().max(80).optional() }),
    prepare: async (ctx, input) => {
      const id = await orderIdByNumber(ctx.workspaceId, input.number);
      const o = id ? await getOrder(ctx.workspaceId, id) : null;
      if (!o) return { error: 'not_found' };
      if (o.status !== 'paid') return { error: 'invalid_status', hint: { status: o.status } };
      return {
        summary: `Fulfill order #${o.number}`,
        details: [
          { label: 'Order', after: `#${o.number} · ${o.email}` },
          { label: 'Status', before: 'Paid', after: 'Fulfilled' },
          ...(input.trackingNumber ? [{ label: 'Tracking', after: `${input.carrier ? `${input.carrier} ` : ''}${input.trackingNumber}` }] : []),
        ],
        input: { orderId: o.id, trackingNumber: input.trackingNumber ?? '', carrier: input.carrier ?? '' },
      };
    },
    execute: async (ctx, input) => {
      try {
        const o = await fulfillOrder(actor(ctx), String(input.orderId), { trackingNumber: String(input.trackingNumber ?? ''), trackingCompany: String(input.carrier ?? '') });
        return { ok: true, message: `Order #${o.number} fulfilled.`, href: `/app/shop/orders/${o.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
  writeTool({
    name: 'propose_shop_discount',
    app: 'shop',
    description: 'Prepare a Shop discount code: percent (e.g. 10 for 10%), fixed amount in the store currency, or free shipping; optional usage limit and end date (YYYY-MM-DD). The person confirms first.',
    input: z.object({
      code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
      kind: z.enum(['percent', 'fixed', 'free_shipping']),
      value: z.number().min(0).max(1_000_000).optional(),
      usageLimit: z.number().int().min(1).max(1_000_000).optional(),
      endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    prepare: async (ctx, input) => {
      const store = await ensureStore(ctx.workspaceId);
      const what = input.kind === 'percent' ? `${input.value ?? 0}% off` : input.kind === 'fixed' ? `${formatMoney(Math.round((input.value ?? 0) * 100), store.currency)} off` : 'Free shipping';
      return {
        summary: `Create discount ${input.code.toUpperCase()}`,
        details: [
          { label: 'Code', after: input.code.toUpperCase() },
          { label: 'Discount', after: what },
          ...(input.usageLimit ? [{ label: 'Uses', after: String(input.usageLimit) }] : []),
          ...(input.endsOn ? [{ label: 'Ends', after: input.endsOn }] : []),
        ],
        input: { ...input },
      };
    },
    execute: async (ctx, input) => {
      const kind = input.kind as 'percent' | 'fixed' | 'free_shipping';
      const value = Number(input.value ?? 0);
      try {
        const d = await createDiscount(actor(ctx), {
          code: String(input.code),
          kind,
          value: kind === 'percent' ? Math.round(value * 100) : kind === 'fixed' ? Math.round(value * 100) : 0,
          usageLimit: input.usageLimit ? Number(input.usageLimit) : null,
          endsAt: input.endsOn ? `${String(input.endsOn)}T23:59:59Z` : null,
        });
        return { ok: true, message: `Discount ${d.code} created.`, href: `/app/shop/discounts/${d.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
];
