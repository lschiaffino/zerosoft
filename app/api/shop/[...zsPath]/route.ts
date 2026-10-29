// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/shop/collections/[id]/route';
import * as m1 from '@/lib/routes/shop/customers/[id]/route';
import * as m2 from '@/lib/routes/shop/discounts/[id]/route';
import * as m3 from '@/lib/routes/shop/locations/[id]/route';
import * as m4 from '@/lib/routes/shop/orders/[id]/route';
import * as m5 from '@/lib/routes/shop/orders/[id]/cancel/route';
import * as m6 from '@/lib/routes/shop/orders/[id]/fulfill/route';
import * as m7 from '@/lib/routes/shop/orders/[id]/mark-paid/route';
import * as m8 from '@/lib/routes/shop/orders/[id]/notes/route';
import * as m9 from '@/lib/routes/shop/orders/[id]/refund/route';
import * as m10 from '@/lib/routes/shop/products/[id]/route';
import * as m11 from '@/lib/routes/shop/public/[handle]/cart/route';
import * as m12 from '@/lib/routes/shop/public/[handle]/checkout/route';
import * as m13 from '@/lib/routes/shop/public/[handle]/order/route';
import * as m14 from '@/lib/routes/shop/public/[handle]/search/route';
import * as m15 from '@/lib/routes/shop/public/[handle]/sitemap/route';
import * as m16 from '@/lib/routes/shop/public/[handle]/view/route';
import * as m17 from '@/lib/routes/shop/webhooks/mercadopago/[token]/route';
import * as m18 from '@/lib/routes/shop/webhooks/stripe/[token]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'collections/[id]', mod: m0 }, // lib/routes/shop/collections/[id]
  { pattern: 'customers/[id]', mod: m1 }, // lib/routes/shop/customers/[id]
  { pattern: 'discounts/[id]', mod: m2 }, // lib/routes/shop/discounts/[id]
  { pattern: 'locations/[id]', mod: m3 }, // lib/routes/shop/locations/[id]
  { pattern: 'orders/[id]', mod: m4 }, // lib/routes/shop/orders/[id]
  { pattern: 'orders/[id]/cancel', mod: m5 }, // lib/routes/shop/orders/[id]/cancel
  { pattern: 'orders/[id]/fulfill', mod: m6 }, // lib/routes/shop/orders/[id]/fulfill
  { pattern: 'orders/[id]/mark-paid', mod: m7 }, // lib/routes/shop/orders/[id]/mark-paid
  { pattern: 'orders/[id]/notes', mod: m8 }, // lib/routes/shop/orders/[id]/notes
  { pattern: 'orders/[id]/refund', mod: m9 }, // lib/routes/shop/orders/[id]/refund
  { pattern: 'products/[id]', mod: m10 }, // lib/routes/shop/products/[id]
  { pattern: 'public/[handle]/cart', mod: m11 }, // lib/routes/shop/public/[handle]/cart
  { pattern: 'public/[handle]/checkout', mod: m12 }, // lib/routes/shop/public/[handle]/checkout
  { pattern: 'public/[handle]/order', mod: m13 }, // lib/routes/shop/public/[handle]/order
  { pattern: 'public/[handle]/search', mod: m14 }, // lib/routes/shop/public/[handle]/search
  { pattern: 'public/[handle]/sitemap', mod: m15 }, // lib/routes/shop/public/[handle]/sitemap
  { pattern: 'public/[handle]/view', mod: m16 }, // lib/routes/shop/public/[handle]/view
  { pattern: 'webhooks/mercadopago/[token]', mod: m17 }, // lib/routes/shop/webhooks/mercadopago/[token]
  { pattern: 'webhooks/stripe/[token]', mod: m18 }, // lib/routes/shop/webhooks/stripe/[token]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
