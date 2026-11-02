// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/send/docs/route";
import * as r1 from "@/app/api/send/documents/route";
import * as r2 from "@/lib/routes/send/documents/[id]/route";
import * as r3 from "@/lib/routes/send/documents/[id]/analytics/route";
import * as r4 from "@/lib/routes/send/documents/[id]/export/route";
import * as r5 from "@/lib/routes/send/documents/[id]/links/route";
import * as r6 from "@/lib/routes/send/documents/[id]/live/route";
import * as r7 from "@/lib/routes/send/links/[id]/route";
import * as r8 from "@/app/api/send/settings/route";
import * as r9 from "@/app/api/send/spaces/route";
import * as r10 from "@/lib/routes/send/spaces/[id]/route";
import * as r11 from "@/lib/routes/send/spaces/[id]/analytics/route";
import * as r12 from "@/lib/routes/send/spaces/[id]/links/route";

export const routes: Record<string, unknown> = {
  "/api/send/docs": r0,
  "/api/send/documents": r1,
  "/api/send/documents/[id]": r2,
  "/api/send/documents/[id]/analytics": r3,
  "/api/send/documents/[id]/export": r4,
  "/api/send/documents/[id]/links": r5,
  "/api/send/documents/[id]/live": r6,
  "/api/send/links/[id]": r7,
  "/api/send/settings": r8,
  "/api/send/spaces": r9,
  "/api/send/spaces/[id]": r10,
  "/api/send/spaces/[id]/analytics": r11,
  "/api/send/spaces/[id]/links": r12,
};
