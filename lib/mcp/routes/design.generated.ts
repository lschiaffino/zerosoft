// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/design/ai/route";
import * as r1 from "@/app/api/design/board/route";
import * as r2 from "@/app/api/design/brand/route";
import * as r3 from "@/app/api/design/designs/route";
import * as r4 from "@/lib/routes/design/designs/[id]/route";
import * as r5 from "@/lib/routes/design/designs/[id]/comments/route";
import * as r6 from "@/lib/routes/design/designs/[id]/comments/[cid]/route";
import * as r7 from "@/lib/routes/design/designs/[id]/duplicate/route";
import * as r8 from "@/lib/routes/design/designs/[id]/presence/route";
import * as r9 from "@/lib/routes/design/designs/[id]/share/route";
import * as r10 from "@/lib/routes/design/designs/[id]/template/route";
import * as r11 from "@/app/api/design/files/route";
import * as r12 from "@/lib/routes/design/files/[id]/route";
import * as r13 from "@/app/api/design/folders/route";
import * as r14 from "@/lib/routes/design/folders/[id]/route";
import * as r15 from "@/app/api/design/people/route";
import * as r16 from "@/app/api/design/templates/route";

export const routes: Record<string, unknown> = {
  "/api/design/ai": r0,
  "/api/design/board": r1,
  "/api/design/brand": r2,
  "/api/design/designs": r3,
  "/api/design/designs/[id]": r4,
  "/api/design/designs/[id]/comments": r5,
  "/api/design/designs/[id]/comments/[cid]": r6,
  "/api/design/designs/[id]/duplicate": r7,
  "/api/design/designs/[id]/presence": r8,
  "/api/design/designs/[id]/share": r9,
  "/api/design/designs/[id]/template": r10,
  "/api/design/files": r11,
  "/api/design/files/[id]": r12,
  "/api/design/folders": r13,
  "/api/design/folders/[id]": r14,
  "/api/design/people": r15,
  "/api/design/templates": r16,
};
