// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/sign/docs/route";
import * as r1 from "@/app/api/sign/envelopes/route";
import * as r2 from "@/lib/routes/sign/envelopes/[id]/route";
import * as r3 from "@/lib/routes/sign/envelopes/[id]/actions/route";
import * as r4 from "@/lib/routes/sign/envelopes/[id]/document/route";
import * as r5 from "@/lib/routes/sign/envelopes/[id]/fields/route";
import * as r6 from "@/lib/routes/sign/envelopes/[id]/recipients/route";
import * as r7 from "@/app/api/sign/integrations/hiring-offer/route";
import * as r8 from "@/app/api/sign/templates/route";
import * as r9 from "@/lib/routes/sign/templates/[id]/route";
import * as r10 from "@/lib/routes/sign/templates/[id]/document/route";
import * as r11 from "@/lib/routes/sign/templates/[id]/use/route";

export const routes: Record<string, unknown> = {
  "/api/sign/docs": r0,
  "/api/sign/envelopes": r1,
  "/api/sign/envelopes/[id]": r2,
  "/api/sign/envelopes/[id]/actions": r3,
  "/api/sign/envelopes/[id]/document": r4,
  "/api/sign/envelopes/[id]/fields": r5,
  "/api/sign/envelopes/[id]/recipients": r6,
  "/api/sign/integrations/hiring-offer": r7,
  "/api/sign/templates": r8,
  "/api/sign/templates/[id]": r9,
  "/api/sign/templates/[id]/document": r10,
  "/api/sign/templates/[id]/use": r11,
};
