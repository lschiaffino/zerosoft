// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/books/accounts/route";
import * as r1 from "@/lib/routes/books/accounts/[id]/route";
import * as r2 from "@/app/api/books/audit/route";
import * as r3 from "@/app/api/books/bank-accounts/route";
import * as r4 from "@/lib/routes/books/bank-accounts/[id]/route";
import * as r5 from "@/lib/routes/books/bank-accounts/[id]/import/route";
import * as r6 from "@/lib/routes/books/bank-transactions/[id]/reconcile/route";
import * as r7 from "@/lib/routes/books/bank-transactions/[id]/unreconcile/route";
import * as r8 from "@/app/api/books/contacts/route";
import * as r9 from "@/lib/routes/books/contacts/[id]/route";
import * as r10 from "@/app/api/books/contacts/crm/route";
import * as r11 from "@/app/api/books/documents/route";
import * as r12 from "@/lib/routes/books/documents/[id]/route";
import * as r13 from "@/lib/routes/books/documents/[id]/approve/route";
import * as r14 from "@/lib/routes/books/documents/[id]/credit-note/route";
import * as r15 from "@/lib/routes/books/documents/[id]/einvoice/route";
import * as r16 from "@/lib/routes/books/documents/[id]/payments/route";
import * as r17 from "@/lib/routes/books/documents/[id]/pdf/route";
import * as r18 from "@/lib/routes/books/documents/[id]/send/route";
import * as r19 from "@/lib/routes/books/documents/[id]/void/route";
import * as r20 from "@/app/api/books/documents/from-quote/route";
import * as r21 from "@/app/api/books/expenses/route";
import * as r22 from "@/lib/routes/books/expenses/[id]/route";
import * as r23 from "@/lib/routes/books/expenses/[id]/extract/route";
import * as r24 from "@/lib/routes/books/expenses/[id]/post/route";
import * as r25 from "@/lib/routes/books/expenses/[id]/receipt/route";
import * as r26 from "@/lib/routes/books/expenses/[id]/void/route";
import * as r27 from "@/app/api/books/items/route";
import * as r28 from "@/lib/routes/books/items/[id]/route";
import * as r29 from "@/lib/routes/books/items/[id]/stock/route";
import * as r30 from "@/app/api/books/items/shop-variants/route";
import * as r31 from "@/app/api/books/journals/route";
import * as r32 from "@/lib/routes/books/journals/[id]/route";
import * as r33 from "@/lib/routes/books/journals/[id]/reverse/route";
import * as r34 from "@/lib/routes/books/payments/[id]/route";
import * as r35 from "@/app/api/books/purchase-orders/route";
import * as r36 from "@/lib/routes/books/purchase-orders/[id]/route";
import * as r37 from "@/lib/routes/books/purchase-orders/[id]/bill/route";
import * as r38 from "@/lib/routes/books/purchase-orders/[id]/receive/route";
import * as r39 from "@/app/api/books/recurring/route";
import * as r40 from "@/lib/routes/books/recurring/[id]/route";
import * as r41 from "@/app/api/books/reports/route";
import * as r42 from "@/app/api/books/series/route";
import * as r43 from "@/lib/routes/books/series/[id]/route";
import * as r44 from "@/app/api/books/settings/route";
import * as r45 from "@/app/api/books/settings/country/route";
import * as r46 from "@/app/api/books/settings/logo/route";
import * as r47 from "@/app/api/books/settings/roles/route";
import * as r48 from "@/app/api/books/taxes/route";
import * as r49 from "@/lib/routes/books/taxes/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/books/accounts": r0,
  "/api/books/accounts/[id]": r1,
  "/api/books/audit": r2,
  "/api/books/bank-accounts": r3,
  "/api/books/bank-accounts/[id]": r4,
  "/api/books/bank-accounts/[id]/import": r5,
  "/api/books/bank-transactions/[id]/reconcile": r6,
  "/api/books/bank-transactions/[id]/unreconcile": r7,
  "/api/books/contacts": r8,
  "/api/books/contacts/[id]": r9,
  "/api/books/contacts/crm": r10,
  "/api/books/documents": r11,
  "/api/books/documents/[id]": r12,
  "/api/books/documents/[id]/approve": r13,
  "/api/books/documents/[id]/credit-note": r14,
  "/api/books/documents/[id]/einvoice": r15,
  "/api/books/documents/[id]/payments": r16,
  "/api/books/documents/[id]/pdf": r17,
  "/api/books/documents/[id]/send": r18,
  "/api/books/documents/[id]/void": r19,
  "/api/books/documents/from-quote": r20,
  "/api/books/expenses": r21,
  "/api/books/expenses/[id]": r22,
  "/api/books/expenses/[id]/extract": r23,
  "/api/books/expenses/[id]/post": r24,
  "/api/books/expenses/[id]/receipt": r25,
  "/api/books/expenses/[id]/void": r26,
  "/api/books/items": r27,
  "/api/books/items/[id]": r28,
  "/api/books/items/[id]/stock": r29,
  "/api/books/items/shop-variants": r30,
  "/api/books/journals": r31,
  "/api/books/journals/[id]": r32,
  "/api/books/journals/[id]/reverse": r33,
  "/api/books/payments/[id]": r34,
  "/api/books/purchase-orders": r35,
  "/api/books/purchase-orders/[id]": r36,
  "/api/books/purchase-orders/[id]/bill": r37,
  "/api/books/purchase-orders/[id]/receive": r38,
  "/api/books/recurring": r39,
  "/api/books/recurring/[id]": r40,
  "/api/books/reports": r41,
  "/api/books/series": r42,
  "/api/books/series/[id]": r43,
  "/api/books/settings": r44,
  "/api/books/settings/country": r45,
  "/api/books/settings/logo": r46,
  "/api/books/settings/roles": r47,
  "/api/books/taxes": r48,
  "/api/books/taxes/[id]": r49,
};
