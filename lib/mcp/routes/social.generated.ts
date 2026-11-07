// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/social/accounts/route";
import * as r1 from "@/lib/routes/social/accounts/[id]/route";
import * as r2 from "@/lib/routes/social/accounts/[id]/slots/route";
import * as r3 from "@/app/api/social/analytics/route";
import * as r4 from "@/app/api/social/best-times/route";
import * as r5 from "@/app/api/social/bootstrap/route";
import * as r6 from "@/app/api/social/inbox/route";
import * as r7 from "@/lib/routes/social/inbox/[id]/route";
import * as r8 from "@/app/api/social/library/route";
import * as r9 from "@/lib/routes/social/library/[id]/route";
import * as r10 from "@/app/api/social/people/route";
import * as r11 from "@/app/api/social/posts/route";
import * as r12 from "@/lib/routes/social/posts/[id]/route";
import * as r13 from "@/app/api/social/queue-next/route";
import * as r14 from "@/app/api/social/shorten/route";
import * as r15 from "@/app/api/social/upload/route";

export const routes: Record<string, unknown> = {
  "/api/social/accounts": r0,
  "/api/social/accounts/[id]": r1,
  "/api/social/accounts/[id]/slots": r2,
  "/api/social/analytics": r3,
  "/api/social/best-times": r4,
  "/api/social/bootstrap": r5,
  "/api/social/inbox": r6,
  "/api/social/inbox/[id]": r7,
  "/api/social/library": r8,
  "/api/social/library/[id]": r9,
  "/api/social/people": r10,
  "/api/social/posts": r11,
  "/api/social/posts/[id]": r12,
  "/api/social/queue-next": r13,
  "/api/social/shorten": r14,
  "/api/social/upload": r15,
};
