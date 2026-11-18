// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/lib/routes/shop/abandoned/[id]/route";
import * as r1 from "@/app/api/shop/analytics/route";
import * as r2 from "@/app/api/shop/collections/route";
import * as r3 from "@/lib/routes/shop/collections/[id]/route";
import * as r4 from "@/app/api/shop/customers/route";
import * as r5 from "@/lib/routes/shop/customers/[id]/route";
import * as r6 from "@/app/api/shop/discounts/route";
import * as r7 from "@/lib/routes/shop/discounts/[id]/route";
import * as r8 from "@/app/api/shop/drafts/route";
import * as r9 from "@/app/api/shop/images/route";
import * as r10 from "@/app/api/shop/inventory/route";
import * as r11 from "@/app/api/shop/inventory/history/route";
import * as r12 from "@/app/api/shop/locations/route";
import * as r13 from "@/lib/routes/shop/locations/[id]/route";
import * as r14 from "@/app/api/shop/orders/route";
import * as r15 from "@/lib/routes/shop/orders/[id]/route";
import * as r16 from "@/lib/routes/shop/orders/[id]/cancel/route";
import * as r17 from "@/lib/routes/shop/orders/[id]/draft/route";
import * as r18 from "@/lib/routes/shop/orders/[id]/fulfill/route";
import * as r19 from "@/lib/routes/shop/orders/[id]/invoice/route";
import * as r20 from "@/lib/routes/shop/orders/[id]/mark-paid/route";
import * as r21 from "@/lib/routes/shop/orders/[id]/notes/route";
import * as r22 from "@/lib/routes/shop/orders/[id]/refund/route";
import * as r23 from "@/lib/routes/shop/orders/[id]/returns/route";
import * as r24 from "@/app/api/shop/pages/route";
import * as r25 from "@/lib/routes/shop/pages/[id]/route";
import * as r26 from "@/app/api/shop/payments/route";
import * as r27 from "@/app/api/shop/products/route";
import * as r28 from "@/lib/routes/shop/products/[id]/route";
import * as r29 from "@/app/api/shop/products/bulk/route";
import * as r30 from "@/app/api/shop/products/export/route";
import * as r31 from "@/app/api/shop/products/import/route";
import * as r32 from "@/app/api/shop/purchase-orders/route";
import * as r33 from "@/lib/routes/shop/purchase-orders/[id]/route";
import * as r34 from "@/app/api/shop/reports/export/route";
import * as r35 from "@/lib/routes/shop/returns/[id]/route";
import * as r36 from "@/app/api/shop/share-link/route";
import * as r37 from "@/app/api/shop/shipping/route";
import * as r38 from "@/app/api/shop/store/route";
import * as r39 from "@/app/api/shop/taxes/route";
import * as r40 from "@/app/api/shop/transfers/route";

export const routes: Record<string, unknown> = {
  "/api/shop/abandoned/[id]": r0,
  "/api/shop/analytics": r1,
  "/api/shop/collections": r2,
  "/api/shop/collections/[id]": r3,
  "/api/shop/customers": r4,
  "/api/shop/customers/[id]": r5,
  "/api/shop/discounts": r6,
  "/api/shop/discounts/[id]": r7,
  "/api/shop/drafts": r8,
  "/api/shop/images": r9,
  "/api/shop/inventory": r10,
  "/api/shop/inventory/history": r11,
  "/api/shop/locations": r12,
  "/api/shop/locations/[id]": r13,
  "/api/shop/orders": r14,
  "/api/shop/orders/[id]": r15,
  "/api/shop/orders/[id]/cancel": r16,
  "/api/shop/orders/[id]/draft": r17,
  "/api/shop/orders/[id]/fulfill": r18,
  "/api/shop/orders/[id]/invoice": r19,
  "/api/shop/orders/[id]/mark-paid": r20,
  "/api/shop/orders/[id]/notes": r21,
  "/api/shop/orders/[id]/refund": r22,
  "/api/shop/orders/[id]/returns": r23,
  "/api/shop/pages": r24,
  "/api/shop/pages/[id]": r25,
  "/api/shop/payments": r26,
  "/api/shop/products": r27,
  "/api/shop/products/[id]": r28,
  "/api/shop/products/bulk": r29,
  "/api/shop/products/export": r30,
  "/api/shop/products/import": r31,
  "/api/shop/purchase-orders": r32,
  "/api/shop/purchase-orders/[id]": r33,
  "/api/shop/reports/export": r34,
  "/api/shop/returns/[id]": r35,
  "/api/shop/share-link": r36,
  "/api/shop/shipping": r37,
  "/api/shop/store": r38,
  "/api/shop/taxes": r39,
  "/api/shop/transfers": r40,
};
