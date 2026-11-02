// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/hiring/applications/route";
import * as r1 from "@/lib/routes/hiring/applications/[id]/route";
import * as r2 from "@/lib/routes/hiring/applications/[id]/emails/route";
import * as r3 from "@/lib/routes/hiring/applications/[id]/evaluators/route";
import * as r4 from "@/lib/routes/hiring/applications/[id]/interviews/route";
import * as r5 from "@/lib/routes/hiring/applications/[id]/notes/route";
import * as r6 from "@/lib/routes/hiring/applications/[id]/offers/route";
import * as r7 from "@/lib/routes/hiring/applications/[id]/scorecards/route";
import * as r8 from "@/app/api/hiring/applications/bulk/route";
import * as r9 from "@/lib/routes/hiring/candidates/[id]/route";
import * as r10 from "@/lib/routes/hiring/candidates/[id]/ai/route";
import * as r11 from "@/lib/routes/hiring/candidates/[id]/resume/route";
import * as r12 from "@/app/api/hiring/docs-import/route";
import * as r13 from "@/app/api/hiring/evaluations/route";
import * as r14 from "@/app/api/hiring/jobs/route";
import * as r15 from "@/lib/routes/hiring/jobs/[id]/route";
import * as r16 from "@/lib/routes/hiring/jobs/[id]/share-link/route";
import * as r17 from "@/lib/routes/hiring/jobs/[id]/stages/route";
import * as r18 from "@/lib/routes/hiring/jobs/[id]/team/route";
import * as r19 from "@/lib/routes/hiring/offers/[id]/route";
import * as r20 from "@/app/api/hiring/reports/route";
import * as r21 from "@/app/api/hiring/settings/route";
import * as r22 from "@/app/api/hiring/templates/route";
import * as r23 from "@/lib/routes/hiring/templates/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/hiring/applications": r0,
  "/api/hiring/applications/[id]": r1,
  "/api/hiring/applications/[id]/emails": r2,
  "/api/hiring/applications/[id]/evaluators": r3,
  "/api/hiring/applications/[id]/interviews": r4,
  "/api/hiring/applications/[id]/notes": r5,
  "/api/hiring/applications/[id]/offers": r6,
  "/api/hiring/applications/[id]/scorecards": r7,
  "/api/hiring/applications/bulk": r8,
  "/api/hiring/candidates/[id]": r9,
  "/api/hiring/candidates/[id]/ai": r10,
  "/api/hiring/candidates/[id]/resume": r11,
  "/api/hiring/docs-import": r12,
  "/api/hiring/evaluations": r13,
  "/api/hiring/jobs": r14,
  "/api/hiring/jobs/[id]": r15,
  "/api/hiring/jobs/[id]/share-link": r16,
  "/api/hiring/jobs/[id]/stages": r17,
  "/api/hiring/jobs/[id]/team": r18,
  "/api/hiring/offers/[id]": r19,
  "/api/hiring/reports": r20,
  "/api/hiring/settings": r21,
  "/api/hiring/templates": r22,
  "/api/hiring/templates/[id]": r23,
};
