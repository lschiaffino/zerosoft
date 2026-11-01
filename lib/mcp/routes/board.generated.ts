// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/board/comments/[id]/route";
import * as r1 from "@/app/api/board/items/route";
import * as r2 from "@/app/api/board/items/[id]/comments/route";
import * as r3 from "@/app/api/board/items/[id]/subscribe/route";
import * as r4 from "@/app/api/board/items/[id]/vote/route";

export const routes: Record<string, unknown> = {
  "/api/board/comments/[id]": r0,
  "/api/board/items": r1,
  "/api/board/items/[id]/comments": r2,
  "/api/board/items/[id]/subscribe": r3,
  "/api/board/items/[id]/vote": r4,
};
