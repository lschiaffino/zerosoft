// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/time/approvals/route";
import * as r1 from "@/app/api/time/clients/route";
import * as r2 from "@/lib/routes/time/clients/[id]/route";
import * as r3 from "@/app/api/time/entries/route";
import * as r4 from "@/lib/routes/time/entries/[id]/route";
import * as r5 from "@/app/api/time/projects/route";
import * as r6 from "@/lib/routes/time/projects/[id]/route";
import * as r7 from "@/app/api/time/report/route";
import * as r8 from "@/app/api/time/settings/route";
import * as r9 from "@/app/api/time/tasks/route";
import * as r10 from "@/lib/routes/time/tasks/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/time/approvals": r0,
  "/api/time/clients": r1,
  "/api/time/clients/[id]": r2,
  "/api/time/entries": r3,
  "/api/time/entries/[id]": r4,
  "/api/time/projects": r5,
  "/api/time/projects/[id]": r6,
  "/api/time/report": r7,
  "/api/time/settings": r8,
  "/api/time/tasks": r9,
  "/api/time/tasks/[id]": r10,
};
