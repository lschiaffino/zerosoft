// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/integrations/gmail/disconnect/route";
import * as r1 from "@/app/api/integrations/gmail/sync/route";
import * as r2 from "@/app/api/integrations/google-calendar/disconnect/route";
import * as r3 from "@/app/api/integrations/notion/webhook/route";
import * as r4 from "@/app/api/integrations/outlook/disconnect/route";
import * as r5 from "@/app/api/integrations/outlook/sync/route";

export const routes: Record<string, unknown> = {
  "/api/integrations/gmail/disconnect": r0,
  "/api/integrations/gmail/sync": r1,
  "/api/integrations/google-calendar/disconnect": r2,
  "/api/integrations/notion/webhook": r3,
  "/api/integrations/outlook/disconnect": r4,
  "/api/integrations/outlook/sync": r5,
};
