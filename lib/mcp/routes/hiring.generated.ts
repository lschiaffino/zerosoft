// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/hiring/applications/route";
import * as r1 from "@/lib/routes/hiring/applications/[id]/route";
import * as r2 from "@/lib/routes/hiring/applications/[id]/copy/route";
import * as r3 from "@/lib/routes/hiring/applications/[id]/emails/route";
import * as r4 from "@/lib/routes/hiring/applications/[id]/evaluators/route";
import * as r5 from "@/lib/routes/hiring/applications/[id]/interviews/route";
import * as r6 from "@/lib/routes/hiring/applications/[id]/notes/route";
import * as r7 from "@/lib/routes/hiring/applications/[id]/offers/route";
import * as r8 from "@/lib/routes/hiring/applications/[id]/scorecards/route";
import * as r9 from "@/app/api/hiring/applications/bulk/route";
import * as r10 from "@/lib/routes/hiring/candidates/[id]/route";
import * as r11 from "@/lib/routes/hiring/candidates/[id]/ai/route";
import * as r12 from "@/lib/routes/hiring/candidates/[id]/merge/route";
import * as r13 from "@/lib/routes/hiring/candidates/[id]/resume/route";
import * as r14 from "@/app/api/hiring/docs-import/route";
import * as r15 from "@/app/api/hiring/evaluations/route";
import * as r16 from "@/app/api/hiring/export/route";
import * as r17 from "@/app/api/hiring/jobs/route";
import * as r18 from "@/lib/routes/hiring/jobs/[id]/route";
import * as r19 from "@/lib/routes/hiring/jobs/[id]/approval/route";
import * as r20 from "@/lib/routes/hiring/jobs/[id]/import/route";
import * as r21 from "@/lib/routes/hiring/jobs/[id]/share-link/route";
import * as r22 from "@/lib/routes/hiring/jobs/[id]/stages/route";
import * as r23 from "@/lib/routes/hiring/jobs/[id]/team/route";
import * as r24 from "@/lib/routes/hiring/offers/[id]/route";
import * as r25 from "@/app/api/hiring/reports/route";
import * as r26 from "@/app/api/hiring/settings/route";
import * as r27 from "@/app/api/hiring/templates/route";
import * as r28 from "@/lib/routes/hiring/templates/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/hiring/applications": r0,
  "/api/hiring/applications/[id]": r1,
  "/api/hiring/applications/[id]/copy": r2,
  "/api/hiring/applications/[id]/emails": r3,
  "/api/hiring/applications/[id]/evaluators": r4,
  "/api/hiring/applications/[id]/interviews": r5,
  "/api/hiring/applications/[id]/notes": r6,
  "/api/hiring/applications/[id]/offers": r7,
  "/api/hiring/applications/[id]/scorecards": r8,
  "/api/hiring/applications/bulk": r9,
  "/api/hiring/candidates/[id]": r10,
  "/api/hiring/candidates/[id]/ai": r11,
  "/api/hiring/candidates/[id]/merge": r12,
  "/api/hiring/candidates/[id]/resume": r13,
  "/api/hiring/docs-import": r14,
  "/api/hiring/evaluations": r15,
  "/api/hiring/export": r16,
  "/api/hiring/jobs": r17,
  "/api/hiring/jobs/[id]": r18,
  "/api/hiring/jobs/[id]/approval": r19,
  "/api/hiring/jobs/[id]/import": r20,
  "/api/hiring/jobs/[id]/share-link": r21,
  "/api/hiring/jobs/[id]/stages": r22,
  "/api/hiring/jobs/[id]/team": r23,
  "/api/hiring/offers/[id]": r24,
  "/api/hiring/reports": r25,
  "/api/hiring/settings": r26,
  "/api/hiring/templates": r27,
  "/api/hiring/templates/[id]": r28,
};
