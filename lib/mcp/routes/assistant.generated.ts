// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/assistant/route";
import * as r1 from "@/lib/routes/assistant/chat-access/[app]/route";
import * as r2 from "@/app/api/assistant/conversations/route";
import * as r3 from "@/lib/routes/assistant/conversations/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/assistant": r0,
  "/api/assistant/chat-access/[app]": r1,
  "/api/assistant/conversations": r2,
  "/api/assistant/conversations/[id]": r3,
};
