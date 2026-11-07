// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/teams/route";
import * as r1 from "@/app/api/teams/groups/route";
import * as r2 from "@/lib/routes/teams/groups/[id]/route";
import * as r3 from "@/app/api/teams/invites/route";
import * as r4 from "@/app/api/teams/members/route";
import * as r5 from "@/lib/routes/teams/members/[userId]/route";
import * as r6 from "@/app/api/teams/workspace/route";
import * as r7 from "@/app/api/teams/workspace/logo/route";

export const routes: Record<string, unknown> = {
  "/api/teams": r0,
  "/api/teams/groups": r1,
  "/api/teams/groups/[id]": r2,
  "/api/teams/invites": r3,
  "/api/teams/members": r4,
  "/api/teams/members/[userId]": r5,
  "/api/teams/workspace": r6,
  "/api/teams/workspace/logo": r7,
};
