// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/fleet/board/route";
import * as r1 from "@/app/api/fleet/connections/route";
import * as r2 from "@/lib/routes/fleet/connections/[id]/route";
import * as r3 from "@/lib/routes/fleet/connections/[id]/options/route";
import * as r4 from "@/app/api/fleet/prefs/route";
import * as r5 from "@/lib/routes/fleet/sessions/[id]/route";
import * as r6 from "@/lib/routes/fleet/sessions/[id]/messages/route";
import * as r7 from "@/lib/routes/fleet/sessions/[id]/messages/[messageId]/route";
import * as r8 from "@/app/api/fleet/sync/route";
import * as r9 from "@/app/api/fleet/tokens/route";
import * as r10 from "@/lib/routes/fleet/tokens/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/fleet/board": r0,
  "/api/fleet/connections": r1,
  "/api/fleet/connections/[id]": r2,
  "/api/fleet/connections/[id]/options": r3,
  "/api/fleet/prefs": r4,
  "/api/fleet/sessions/[id]": r5,
  "/api/fleet/sessions/[id]/messages": r6,
  "/api/fleet/sessions/[id]/messages/[messageId]": r7,
  "/api/fleet/sync": r8,
  "/api/fleet/tokens": r9,
  "/api/fleet/tokens/[id]": r10,
};
