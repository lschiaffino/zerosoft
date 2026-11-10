// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/calls/ask/route";
import * as r1 from "@/app/api/calls/calls/route";
import * as r2 from "@/lib/routes/calls/calls/[id]/route";
import * as r3 from "@/lib/routes/calls/calls/[id]/ask/route";
import * as r4 from "@/lib/routes/calls/calls/[id]/clips/route";
import * as r5 from "@/lib/routes/calls/calls/[id]/clips/[clipId]/route";
import * as r6 from "@/lib/routes/calls/calls/[id]/comments/route";
import * as r7 from "@/lib/routes/calls/calls/[id]/comments/[commentId]/route";
import * as r8 from "@/lib/routes/calls/calls/[id]/export/route";
import * as r9 from "@/lib/routes/calls/calls/[id]/reanalyze/route";
import * as r10 from "@/lib/routes/calls/calls/[id]/share/route";
import * as r11 from "@/lib/routes/calls/calls/[id]/stop/route";
import * as r12 from "@/app/api/calls/deals/route";
import * as r13 from "@/app/api/calls/export/route";
import * as r14 from "@/app/api/calls/settings/route";
import * as r15 from "@/app/api/calls/upcoming/route";

export const routes: Record<string, unknown> = {
  "/api/calls/ask": r0,
  "/api/calls/calls": r1,
  "/api/calls/calls/[id]": r2,
  "/api/calls/calls/[id]/ask": r3,
  "/api/calls/calls/[id]/clips": r4,
  "/api/calls/calls/[id]/clips/[clipId]": r5,
  "/api/calls/calls/[id]/comments": r6,
  "/api/calls/calls/[id]/comments/[commentId]": r7,
  "/api/calls/calls/[id]/export": r8,
  "/api/calls/calls/[id]/reanalyze": r9,
  "/api/calls/calls/[id]/share": r10,
  "/api/calls/calls/[id]/stop": r11,
  "/api/calls/deals": r12,
  "/api/calls/export": r13,
  "/api/calls/settings": r14,
  "/api/calls/upcoming": r15,
};
