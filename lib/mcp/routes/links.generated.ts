// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/links/route";
import * as r1 from "@/lib/routes/links/[id]/route";
import * as r2 from "@/lib/routes/links/[id]/analytics/route";
import * as r3 from "@/lib/routes/links/[id]/clicks/route";
import * as r4 from "@/lib/routes/links/[id]/comments/route";
import * as r5 from "@/lib/routes/links/[id]/comments/[commentId]/route";
import * as r6 from "@/lib/routes/links/[id]/duplicate/route";
import * as r7 from "@/lib/routes/links/[id]/export.csv/route";
import * as r8 from "@/lib/routes/links/[id]/qr/route";
import * as r9 from "@/app/api/links/ai/route";
import * as r10 from "@/app/api/links/analytics/route";
import * as r11 from "@/app/api/links/analytics/export.csv/route";
import * as r12 from "@/app/api/links/batch/route";
import * as r13 from "@/app/api/links/bio/route";
import * as r14 from "@/app/api/links/bulk/route";
import * as r15 from "@/app/api/links/check-slug/route";
import * as r16 from "@/app/api/links/domains/route";
import * as r17 from "@/lib/routes/links/domains/[id]/route";
import * as r18 from "@/lib/routes/links/domains/[id]/verify/route";
import * as r19 from "@/app/api/links/events/route";
import * as r20 from "@/app/api/links/export/route";
import * as r21 from "@/app/api/links/folders/route";
import * as r22 from "@/lib/routes/links/folders/[id]/route";
import * as r23 from "@/app/api/links/integrations/route";
import * as r24 from "@/app/api/links/publishable-key/route";
import * as r25 from "@/app/api/links/qr-templates/route";
import * as r26 from "@/lib/routes/links/qr-templates/[id]/route";
import * as r27 from "@/app/api/links/shares/route";
import * as r28 from "@/lib/routes/links/shares/[id]/route";
import * as r29 from "@/app/api/links/utm-templates/route";
import * as r30 from "@/lib/routes/links/utm-templates/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/links": r0,
  "/api/links/[id]": r1,
  "/api/links/[id]/analytics": r2,
  "/api/links/[id]/clicks": r3,
  "/api/links/[id]/comments": r4,
  "/api/links/[id]/comments/[commentId]": r5,
  "/api/links/[id]/duplicate": r6,
  "/api/links/[id]/export.csv": r7,
  "/api/links/[id]/qr": r8,
  "/api/links/ai": r9,
  "/api/links/analytics": r10,
  "/api/links/analytics/export.csv": r11,
  "/api/links/batch": r12,
  "/api/links/bio": r13,
  "/api/links/bulk": r14,
  "/api/links/check-slug": r15,
  "/api/links/domains": r16,
  "/api/links/domains/[id]": r17,
  "/api/links/domains/[id]/verify": r18,
  "/api/links/events": r19,
  "/api/links/export": r20,
  "/api/links/folders": r21,
  "/api/links/folders/[id]": r22,
  "/api/links/integrations": r23,
  "/api/links/publishable-key": r24,
  "/api/links/qr-templates": r25,
  "/api/links/qr-templates/[id]": r26,
  "/api/links/shares": r27,
  "/api/links/shares/[id]": r28,
  "/api/links/utm-templates": r29,
  "/api/links/utm-templates/[id]": r30,
};
