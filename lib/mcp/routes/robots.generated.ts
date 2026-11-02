// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/robots/route";
import * as r1 from "@/lib/routes/robots/[id]/route";
import * as r2 from "@/lib/routes/robots/[id]/bulk/route";
import * as r3 from "@/lib/routes/robots/[id]/export/route";
import * as r4 from "@/lib/routes/robots/[id]/recording/route";
import * as r5 from "@/lib/routes/robots/[id]/rows/route";
import * as r6 from "@/lib/routes/robots/[id]/runs/route";
import * as r7 from "@/lib/routes/robots/[id]/session/route";
import * as r8 from "@/lib/routes/robots/[id]/takeover/route";
import * as r9 from "@/app/api/robots/ai/build/route";
import * as r10 from "@/app/api/robots/ai/steps/route";
import * as r11 from "@/lib/routes/robots/batches/[id]/route";
import * as r12 from "@/app/api/robots/recorder-extension/route";
import * as r13 from "@/lib/routes/robots/recordings/[id]/route";
import * as r14 from "@/app/api/robots/run/[id]/route";
import * as r15 from "@/lib/routes/robots/runs/[id]/route";
import * as r16 from "@/lib/routes/robots/runs/[id]/approve/route";
import * as r17 from "@/lib/routes/robots/runs/[id]/fix/route";
import * as r18 from "@/lib/routes/robots/runs/[id]/login-site/route";
import * as r19 from "@/app/api/robots/settings/route";

export const routes: Record<string, unknown> = {
  "/api/robots": r0,
  "/api/robots/[id]": r1,
  "/api/robots/[id]/bulk": r2,
  "/api/robots/[id]/export": r3,
  "/api/robots/[id]/recording": r4,
  "/api/robots/[id]/rows": r5,
  "/api/robots/[id]/runs": r6,
  "/api/robots/[id]/session": r7,
  "/api/robots/[id]/takeover": r8,
  "/api/robots/ai/build": r9,
  "/api/robots/ai/steps": r10,
  "/api/robots/batches/[id]": r11,
  "/api/robots/recorder-extension": r12,
  "/api/robots/recordings/[id]": r13,
  "/api/robots/run/[id]": r14,
  "/api/robots/runs/[id]": r15,
  "/api/robots/runs/[id]/approve": r16,
  "/api/robots/runs/[id]/fix": r17,
  "/api/robots/runs/[id]/login-site": r18,
  "/api/robots/settings": r19,
};
