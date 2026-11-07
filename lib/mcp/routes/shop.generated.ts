// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/shop/analytics/route";
import * as r1 from "@/app/api/shop/collections/route";
import * as r2 from "@/lib/routes/shop/collections/[id]/route";
import * as r3 from "@/app/api/shop/customers/route";
import * as r4 from "@/lib/routes/shop/customers/[id]/route";
import * as r5 from "@/app/api/shop/discounts/route";
import * as r6 from "@/lib/routes/shop/discounts/[id]/route";
import * as r7 from "@/app/api/shop/images/route";
import * as r8 from "@/app/api/shop/inventory/route";
import * as r9 from "@/app/api/shop/inventory/history/route";
import * as r10 from "@/app/api/shop/locations/route";
import * as r11 from "@/lib/routes/shop/locations/[id]/route";
import * as r12 from "@/app/api/shop/orders/route";
import * as r13 from "@/lib/routes/shop/orders/[id]/route";
import * as r14 from "@/lib/routes/shop/orders/[id]/cancel/route";
import * as r15 from "@/lib/routes/shop/orders/[id]/fulfill/route";
import * as r16 from "@/lib/routes/shop/orders/[id]/mark-paid/route";
import * as r17 from "@/lib/routes/shop/orders/[id]/notes/route";
import * as r18 from "@/lib/routes/shop/orders/[id]/refund/route";
import * as r19 from "@/app/api/shop/payments/route";
import * as r20 from "@/app/api/shop/products/route";
import * as r21 from "@/lib/routes/shop/products/[id]/route";
import * as r22 from "@/app/api/shop/products/export/route";
import * as r23 from "@/app/api/shop/products/import/route";
import * as r24 from "@/app/api/shop/share-link/route";
import * as r25 from "@/app/api/shop/shipping/route";
import * as r26 from "@/app/api/shop/store/route";
import * as r27 from "@/app/api/shop/taxes/route";

export const routes: Record<string, unknown> = {
  "/api/shop/analytics": r0,
  "/api/shop/collections": r1,
  "/api/shop/collections/[id]": r2,
  "/api/shop/customers": r3,
  "/api/shop/customers/[id]": r4,
  "/api/shop/discounts": r5,
  "/api/shop/discounts/[id]": r6,
  "/api/shop/images": r7,
  "/api/shop/inventory": r8,
  "/api/shop/inventory/history": r9,
  "/api/shop/locations": r10,
  "/api/shop/locations/[id]": r11,
  "/api/shop/orders": r12,
  "/api/shop/orders/[id]": r13,
  "/api/shop/orders/[id]/cancel": r14,
  "/api/shop/orders/[id]/fulfill": r15,
  "/api/shop/orders/[id]/mark-paid": r16,
  "/api/shop/orders/[id]/notes": r17,
  "/api/shop/orders/[id]/refund": r18,
  "/api/shop/payments": r19,
  "/api/shop/products": r20,
  "/api/shop/products/[id]": r21,
  "/api/shop/products/export": r22,
  "/api/shop/products/import": r23,
  "/api/shop/share-link": r24,
  "/api/shop/shipping": r25,
  "/api/shop/store": r26,
  "/api/shop/taxes": r27,
};
