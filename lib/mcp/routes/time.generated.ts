// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/time/clients/route";
import * as r1 from "@/lib/routes/time/clients/[id]/route";
import * as r2 from "@/app/api/time/entries/route";
import * as r3 from "@/lib/routes/time/entries/[id]/route";
import * as r4 from "@/app/api/time/projects/route";
import * as r5 from "@/lib/routes/time/projects/[id]/route";
import * as r6 from "@/app/api/time/report/route";
import * as r7 from "@/app/api/time/settings/route";
import * as r8 from "@/app/api/time/tasks/route";
import * as r9 from "@/lib/routes/time/tasks/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/time/clients": r0,
  "/api/time/clients/[id]": r1,
  "/api/time/entries": r2,
  "/api/time/entries/[id]": r3,
  "/api/time/projects": r4,
  "/api/time/projects/[id]": r5,
  "/api/time/report": r6,
  "/api/time/settings": r7,
  "/api/time/tasks": r8,
  "/api/time/tasks/[id]": r9,
};
