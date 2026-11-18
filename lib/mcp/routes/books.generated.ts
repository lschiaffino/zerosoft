// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/books/accounts/route";
import * as r1 from "@/lib/routes/books/accounts/[id]/route";
import * as r2 from "@/app/api/books/assets/route";
import * as r3 from "@/lib/routes/books/assets/[id]/route";
import * as r4 from "@/app/api/books/assets/depreciation/route";
import * as r5 from "@/app/api/books/audit/route";
import * as r6 from "@/app/api/books/bank-accounts/route";
import * as r7 from "@/lib/routes/books/bank-accounts/[id]/route";
import * as r8 from "@/lib/routes/books/bank-accounts/[id]/apply-rules/route";
import * as r9 from "@/lib/routes/books/bank-accounts/[id]/import/route";
import * as r10 from "@/app/api/books/bank-rules/route";
import * as r11 from "@/lib/routes/books/bank-rules/[id]/route";
import * as r12 from "@/lib/routes/books/bank-transactions/[id]/reconcile/route";
import * as r13 from "@/lib/routes/books/bank-transactions/[id]/unreconcile/route";
import * as r14 from "@/app/api/books/batches/route";
import * as r15 from "@/lib/routes/books/batches/[id]/route";
import * as r16 from "@/app/api/books/budgets/route";
import * as r17 from "@/lib/routes/books/budgets/[id]/route";
import * as r18 from "@/app/api/books/contacts/route";
import * as r19 from "@/lib/routes/books/contacts/[id]/route";
import * as r20 from "@/lib/routes/books/contacts/[id]/portal/route";
import * as r21 from "@/lib/routes/books/contacts/[id]/statement/route";
import * as r22 from "@/app/api/books/contacts/crm/route";
import * as r23 from "@/app/api/books/documents/route";
import * as r24 from "@/lib/routes/books/documents/[id]/route";
import * as r25 from "@/lib/routes/books/documents/[id]/approve/route";
import * as r26 from "@/lib/routes/books/documents/[id]/credit-note/route";
import * as r27 from "@/lib/routes/books/documents/[id]/einvoice/route";
import * as r28 from "@/lib/routes/books/documents/[id]/payments/route";
import * as r29 from "@/lib/routes/books/documents/[id]/pdf/route";
import * as r30 from "@/lib/routes/books/documents/[id]/send/route";
import * as r31 from "@/lib/routes/books/documents/[id]/void/route";
import * as r32 from "@/app/api/books/documents/from-quote/route";
import * as r33 from "@/app/api/books/expenses/route";
import * as r34 from "@/lib/routes/books/expenses/[id]/route";
import * as r35 from "@/lib/routes/books/expenses/[id]/extract/route";
import * as r36 from "@/lib/routes/books/expenses/[id]/post/route";
import * as r37 from "@/lib/routes/books/expenses/[id]/receipt/route";
import * as r38 from "@/lib/routes/books/expenses/[id]/void/route";
import * as r39 from "@/app/api/books/export/route";
import * as r40 from "@/app/api/books/import/route";
import * as r41 from "@/app/api/books/items/route";
import * as r42 from "@/lib/routes/books/items/[id]/route";
import * as r43 from "@/lib/routes/books/items/[id]/stock/route";
import * as r44 from "@/app/api/books/items/shop-variants/route";
import * as r45 from "@/app/api/books/journals/route";
import * as r46 from "@/lib/routes/books/journals/[id]/route";
import * as r47 from "@/lib/routes/books/journals/[id]/reverse/route";
import * as r48 from "@/app/api/books/opening-balances/route";
import * as r49 from "@/lib/routes/books/payments/[id]/route";
import * as r50 from "@/app/api/books/purchase-orders/route";
import * as r51 from "@/lib/routes/books/purchase-orders/[id]/route";
import * as r52 from "@/lib/routes/books/purchase-orders/[id]/bill/route";
import * as r53 from "@/lib/routes/books/purchase-orders/[id]/receive/route";
import * as r54 from "@/app/api/books/quotes/route";
import * as r55 from "@/lib/routes/books/quotes/[id]/route";
import * as r56 from "@/lib/routes/books/quotes/[id]/invoice/route";
import * as r57 from "@/lib/routes/books/quotes/[id]/send/route";
import * as r58 from "@/app/api/books/recurring/route";
import * as r59 from "@/lib/routes/books/recurring/[id]/route";
import * as r60 from "@/app/api/books/reports/route";
import * as r61 from "@/app/api/books/series/route";
import * as r62 from "@/lib/routes/books/series/[id]/route";
import * as r63 from "@/app/api/books/settings/route";
import * as r64 from "@/app/api/books/settings/country/route";
import * as r65 from "@/app/api/books/settings/logo/route";
import * as r66 from "@/app/api/books/settings/roles/route";
import * as r67 from "@/app/api/books/taxes/route";
import * as r68 from "@/lib/routes/books/taxes/[id]/route";
import * as r69 from "@/app/api/books/tracking/route";
import * as r70 from "@/app/api/books/transfers/route";

export const routes: Record<string, unknown> = {
  "/api/books/accounts": r0,
  "/api/books/accounts/[id]": r1,
  "/api/books/assets": r2,
  "/api/books/assets/[id]": r3,
  "/api/books/assets/depreciation": r4,
  "/api/books/audit": r5,
  "/api/books/bank-accounts": r6,
  "/api/books/bank-accounts/[id]": r7,
  "/api/books/bank-accounts/[id]/apply-rules": r8,
  "/api/books/bank-accounts/[id]/import": r9,
  "/api/books/bank-rules": r10,
  "/api/books/bank-rules/[id]": r11,
  "/api/books/bank-transactions/[id]/reconcile": r12,
  "/api/books/bank-transactions/[id]/unreconcile": r13,
  "/api/books/batches": r14,
  "/api/books/batches/[id]": r15,
  "/api/books/budgets": r16,
  "/api/books/budgets/[id]": r17,
  "/api/books/contacts": r18,
  "/api/books/contacts/[id]": r19,
  "/api/books/contacts/[id]/portal": r20,
  "/api/books/contacts/[id]/statement": r21,
  "/api/books/contacts/crm": r22,
  "/api/books/documents": r23,
  "/api/books/documents/[id]": r24,
  "/api/books/documents/[id]/approve": r25,
  "/api/books/documents/[id]/credit-note": r26,
  "/api/books/documents/[id]/einvoice": r27,
  "/api/books/documents/[id]/payments": r28,
  "/api/books/documents/[id]/pdf": r29,
  "/api/books/documents/[id]/send": r30,
  "/api/books/documents/[id]/void": r31,
  "/api/books/documents/from-quote": r32,
  "/api/books/expenses": r33,
  "/api/books/expenses/[id]": r34,
  "/api/books/expenses/[id]/extract": r35,
  "/api/books/expenses/[id]/post": r36,
  "/api/books/expenses/[id]/receipt": r37,
  "/api/books/expenses/[id]/void": r38,
  "/api/books/export": r39,
  "/api/books/import": r40,
  "/api/books/items": r41,
  "/api/books/items/[id]": r42,
  "/api/books/items/[id]/stock": r43,
  "/api/books/items/shop-variants": r44,
  "/api/books/journals": r45,
  "/api/books/journals/[id]": r46,
  "/api/books/journals/[id]/reverse": r47,
  "/api/books/opening-balances": r48,
  "/api/books/payments/[id]": r49,
  "/api/books/purchase-orders": r50,
  "/api/books/purchase-orders/[id]": r51,
  "/api/books/purchase-orders/[id]/bill": r52,
  "/api/books/purchase-orders/[id]/receive": r53,
  "/api/books/quotes": r54,
  "/api/books/quotes/[id]": r55,
  "/api/books/quotes/[id]/invoice": r56,
  "/api/books/quotes/[id]/send": r57,
  "/api/books/recurring": r58,
  "/api/books/recurring/[id]": r59,
  "/api/books/reports": r60,
  "/api/books/series": r61,
  "/api/books/series/[id]": r62,
  "/api/books/settings": r63,
  "/api/books/settings/country": r64,
  "/api/books/settings/logo": r65,
  "/api/books/settings/roles": r66,
  "/api/books/taxes": r67,
  "/api/books/taxes/[id]": r68,
  "/api/books/tracking": r69,
  "/api/books/transfers": r70,
};
