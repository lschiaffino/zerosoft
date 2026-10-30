// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/books/accounts/[id]/route';
import * as m1 from '@/lib/routes/books/bank-accounts/[id]/route';
import * as m2 from '@/lib/routes/books/bank-accounts/[id]/import/route';
import * as m3 from '@/lib/routes/books/bank-transactions/[id]/reconcile/route';
import * as m4 from '@/lib/routes/books/bank-transactions/[id]/unreconcile/route';
import * as m5 from '@/lib/routes/books/contacts/[id]/route';
import * as m6 from '@/lib/routes/books/documents/[id]/route';
import * as m7 from '@/lib/routes/books/documents/[id]/approve/route';
import * as m8 from '@/lib/routes/books/documents/[id]/credit-note/route';
import * as m9 from '@/lib/routes/books/documents/[id]/einvoice/route';
import * as m10 from '@/lib/routes/books/documents/[id]/link/route';
import * as m11 from '@/lib/routes/books/documents/[id]/payments/route';
import * as m12 from '@/lib/routes/books/documents/[id]/pdf/route';
import * as m13 from '@/lib/routes/books/documents/[id]/send/route';
import * as m14 from '@/lib/routes/books/documents/[id]/void/route';
import * as m15 from '@/lib/routes/books/expenses/[id]/route';
import * as m16 from '@/lib/routes/books/expenses/[id]/extract/route';
import * as m17 from '@/lib/routes/books/expenses/[id]/post/route';
import * as m18 from '@/lib/routes/books/expenses/[id]/receipt/route';
import * as m19 from '@/lib/routes/books/expenses/[id]/void/route';
import * as m20 from '@/lib/routes/books/items/[id]/route';
import * as m21 from '@/lib/routes/books/items/[id]/stock/route';
import * as m22 from '@/lib/routes/books/journals/[id]/route';
import * as m23 from '@/lib/routes/books/journals/[id]/reverse/route';
import * as m24 from '@/lib/routes/books/payments/[id]/route';
import * as m25 from '@/lib/routes/books/public/[token]/pay/route';
import * as m26 from '@/lib/routes/books/public/[token]/pdf/route';
import * as m27 from '@/lib/routes/books/purchase-orders/[id]/route';
import * as m28 from '@/lib/routes/books/purchase-orders/[id]/bill/route';
import * as m29 from '@/lib/routes/books/purchase-orders/[id]/receive/route';
import * as m30 from '@/lib/routes/books/recurring/[id]/route';
import * as m31 from '@/lib/routes/books/series/[id]/route';
import * as m32 from '@/lib/routes/books/taxes/[id]/route';
import * as m33 from '@/lib/routes/books/webhooks/mercadopago/[token]/route';
import * as m34 from '@/lib/routes/books/webhooks/stripe/[token]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'accounts/[id]', mod: m0 }, // lib/routes/books/accounts/[id]
  { pattern: 'bank-accounts/[id]', mod: m1 }, // lib/routes/books/bank-accounts/[id]
  { pattern: 'bank-accounts/[id]/import', mod: m2 }, // lib/routes/books/bank-accounts/[id]/import
  { pattern: 'bank-transactions/[id]/reconcile', mod: m3 }, // lib/routes/books/bank-transactions/[id]/reconcile
  { pattern: 'bank-transactions/[id]/unreconcile', mod: m4 }, // lib/routes/books/bank-transactions/[id]/unreconcile
  { pattern: 'contacts/[id]', mod: m5 }, // lib/routes/books/contacts/[id]
  { pattern: 'documents/[id]', mod: m6 }, // lib/routes/books/documents/[id]
  { pattern: 'documents/[id]/approve', mod: m7 }, // lib/routes/books/documents/[id]/approve
  { pattern: 'documents/[id]/credit-note', mod: m8 }, // lib/routes/books/documents/[id]/credit-note
  { pattern: 'documents/[id]/einvoice', mod: m9 }, // lib/routes/books/documents/[id]/einvoice
  { pattern: 'documents/[id]/link', mod: m10 }, // lib/routes/books/documents/[id]/link
  { pattern: 'documents/[id]/payments', mod: m11 }, // lib/routes/books/documents/[id]/payments
  { pattern: 'documents/[id]/pdf', mod: m12 }, // lib/routes/books/documents/[id]/pdf
  { pattern: 'documents/[id]/send', mod: m13 }, // lib/routes/books/documents/[id]/send
  { pattern: 'documents/[id]/void', mod: m14 }, // lib/routes/books/documents/[id]/void
  { pattern: 'expenses/[id]', mod: m15 }, // lib/routes/books/expenses/[id]
  { pattern: 'expenses/[id]/extract', mod: m16 }, // lib/routes/books/expenses/[id]/extract
  { pattern: 'expenses/[id]/post', mod: m17 }, // lib/routes/books/expenses/[id]/post
  { pattern: 'expenses/[id]/receipt', mod: m18 }, // lib/routes/books/expenses/[id]/receipt
  { pattern: 'expenses/[id]/void', mod: m19 }, // lib/routes/books/expenses/[id]/void
  { pattern: 'items/[id]', mod: m20 }, // lib/routes/books/items/[id]
  { pattern: 'items/[id]/stock', mod: m21 }, // lib/routes/books/items/[id]/stock
  { pattern: 'journals/[id]', mod: m22 }, // lib/routes/books/journals/[id]
  { pattern: 'journals/[id]/reverse', mod: m23 }, // lib/routes/books/journals/[id]/reverse
  { pattern: 'payments/[id]', mod: m24 }, // lib/routes/books/payments/[id]
  { pattern: 'public/[token]/pay', mod: m25 }, // lib/routes/books/public/[token]/pay
  { pattern: 'public/[token]/pdf', mod: m26 }, // lib/routes/books/public/[token]/pdf
  { pattern: 'purchase-orders/[id]', mod: m27 }, // lib/routes/books/purchase-orders/[id]
  { pattern: 'purchase-orders/[id]/bill', mod: m28 }, // lib/routes/books/purchase-orders/[id]/bill
  { pattern: 'purchase-orders/[id]/receive', mod: m29 }, // lib/routes/books/purchase-orders/[id]/receive
  { pattern: 'recurring/[id]', mod: m30 }, // lib/routes/books/recurring/[id]
  { pattern: 'series/[id]', mod: m31 }, // lib/routes/books/series/[id]
  { pattern: 'taxes/[id]', mod: m32 }, // lib/routes/books/taxes/[id]
  { pattern: 'webhooks/mercadopago/[token]', mod: m33 }, // lib/routes/books/webhooks/mercadopago/[token]
  { pattern: 'webhooks/stripe/[token]', mod: m34 }, // lib/routes/books/webhooks/stripe/[token]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
