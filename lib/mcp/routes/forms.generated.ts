// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/forms/route";
import * as r1 from "@/lib/routes/forms/[id]/route";
import * as r2 from "@/lib/routes/forms/[id]/duplicate/route";
import * as r3 from "@/lib/routes/forms/[id]/export/route";
import * as r4 from "@/lib/routes/forms/[id]/responses/route";
import * as r5 from "@/lib/routes/forms/[id]/responses/[rid]/route";
import * as r6 from "@/lib/routes/forms/[id]/summary/route";
import * as r7 from "@/lib/routes/forms/files/[fileId]/route";
import * as r8 from "@/app/api/forms/people/route";
import * as r9 from "@/app/api/forms/settings/route";

export const routes: Record<string, unknown> = {
  "/api/forms": r0,
  "/api/forms/[id]": r1,
  "/api/forms/[id]/duplicate": r2,
  "/api/forms/[id]/export": r3,
  "/api/forms/[id]/responses": r4,
  "/api/forms/[id]/responses/[rid]": r5,
  "/api/forms/[id]/summary": r6,
  "/api/forms/files/[fileId]": r7,
  "/api/forms/people": r8,
  "/api/forms/settings": r9,
};
