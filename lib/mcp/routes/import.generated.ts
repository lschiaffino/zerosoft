// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/import/jobs/route";
import * as r1 from "@/app/api/import/jobs/[id]/route";
import * as r2 from "@/app/api/import/jobs/[id]/run/route";
import * as r3 from "@/app/api/import/jobs/[id]/start/route";

export const routes: Record<string, unknown> = {
  "/api/import/jobs": r0,
  "/api/import/jobs/[id]": r1,
  "/api/import/jobs/[id]/run": r2,
  "/api/import/jobs/[id]/start": r3,
};
