// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/flow/ai/build/route";
import * as r1 from "@/app/api/flow/credentials/route";
import * as r2 from "@/app/api/flow/flows/route";
import * as r3 from "@/lib/routes/flow/flows/[id]/route";
import * as r4 from "@/lib/routes/flow/flows/[id]/held/route";
import * as r5 from "@/lib/routes/flow/flows/[id]/pins/route";
import * as r6 from "@/app/api/flow/flows/[id]/run/route";
import * as r7 from "@/lib/routes/flow/flows/[id]/runs/route";
import * as r8 from "@/app/api/flow/flows/[id]/test-step/route";
import * as r9 from "@/lib/routes/flow/flows/[id]/versions/route";
import * as r10 from "@/lib/routes/flow/flows/[id]/versions/[versionId]/route";
import * as r11 from "@/app/api/flow/folders/route";
import * as r12 from "@/lib/routes/flow/folders/[id]/route";
import * as r13 from "@/app/api/flow/runs/route";
import * as r14 from "@/lib/routes/flow/runs/[id]/route";
import * as r15 from "@/lib/routes/flow/runs/[id]/cancel/route";
import * as r16 from "@/app/api/flow/runs/[id]/explain/route";
import * as r17 from "@/app/api/flow/runs/[id]/replay/route";
import * as r18 from "@/app/api/flow/runs/[id]/rerun/route";
import * as r19 from "@/app/api/flow/runs/export/route";
import * as r20 from "@/app/api/flow/settings/route";
import * as r21 from "@/app/api/flow/stats/route";
import * as r22 from "@/app/api/flow/tables/route";
import * as r23 from "@/lib/routes/flow/tables/[id]/route";
import * as r24 from "@/lib/routes/flow/tables/[id]/rows/route";
import * as r25 from "@/lib/routes/flow/tables/[id]/rows/[rowId]/route";
import * as r26 from "@/app/api/flow/variables/route";
import * as r27 from "@/lib/routes/flow/variables/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/flow/ai/build": r0,
  "/api/flow/credentials": r1,
  "/api/flow/flows": r2,
  "/api/flow/flows/[id]": r3,
  "/api/flow/flows/[id]/held": r4,
  "/api/flow/flows/[id]/pins": r5,
  "/api/flow/flows/[id]/run": r6,
  "/api/flow/flows/[id]/runs": r7,
  "/api/flow/flows/[id]/test-step": r8,
  "/api/flow/flows/[id]/versions": r9,
  "/api/flow/flows/[id]/versions/[versionId]": r10,
  "/api/flow/folders": r11,
  "/api/flow/folders/[id]": r12,
  "/api/flow/runs": r13,
  "/api/flow/runs/[id]": r14,
  "/api/flow/runs/[id]/cancel": r15,
  "/api/flow/runs/[id]/explain": r16,
  "/api/flow/runs/[id]/replay": r17,
  "/api/flow/runs/[id]/rerun": r18,
  "/api/flow/runs/export": r19,
  "/api/flow/settings": r20,
  "/api/flow/stats": r21,
  "/api/flow/tables": r22,
  "/api/flow/tables/[id]": r23,
  "/api/flow/tables/[id]/rows": r24,
  "/api/flow/tables/[id]/rows/[rowId]": r25,
  "/api/flow/variables": r26,
  "/api/flow/variables/[id]": r27,
};
