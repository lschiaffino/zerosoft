// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/bi/ask/route";
import * as r1 from "@/app/api/bi/collections/route";
import * as r2 from "@/lib/routes/bi/collections/[id]/route";
import * as r3 from "@/app/api/bi/compile/route";
import * as r4 from "@/app/api/bi/dashboards/route";
import * as r5 from "@/lib/routes/bi/dashboards/[id]/route";
import * as r6 from "@/lib/routes/bi/dashboards/[id]/cards/route";
import * as r7 from "@/lib/routes/bi/dashboards/[id]/subscriptions/route";
import * as r8 from "@/app/api/bi/databases/route";
import * as r9 from "@/lib/routes/bi/databases/[id]/route";
import * as r10 from "@/lib/routes/bi/databases/[id]/sync/route";
import * as r11 from "@/app/api/bi/items/route";
import * as r12 from "@/app/api/bi/query/route";
import * as r13 from "@/app/api/bi/questions/route";
import * as r14 from "@/lib/routes/bi/questions/[id]/route";
import * as r15 from "@/lib/routes/bi/questions/[id]/run/route";
import * as r16 from "@/app/api/bi/schema/route";
import * as r17 from "@/app/api/bi/shares/route";
import * as r18 from "@/lib/routes/bi/shares/[id]/route";
import * as r19 from "@/lib/routes/bi/subscriptions/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/bi/ask": r0,
  "/api/bi/collections": r1,
  "/api/bi/collections/[id]": r2,
  "/api/bi/compile": r3,
  "/api/bi/dashboards": r4,
  "/api/bi/dashboards/[id]": r5,
  "/api/bi/dashboards/[id]/cards": r6,
  "/api/bi/dashboards/[id]/subscriptions": r7,
  "/api/bi/databases": r8,
  "/api/bi/databases/[id]": r9,
  "/api/bi/databases/[id]/sync": r10,
  "/api/bi/items": r11,
  "/api/bi/query": r12,
  "/api/bi/questions": r13,
  "/api/bi/questions/[id]": r14,
  "/api/bi/questions/[id]/run": r15,
  "/api/bi/schema": r16,
  "/api/bi/shares": r17,
  "/api/bi/shares/[id]": r18,
  "/api/bi/subscriptions/[id]": r19,
};
