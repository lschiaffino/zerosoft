// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/rec/folders/route";
import * as r1 from "@/lib/routes/rec/folders/[id]/route";
import * as r2 from "@/app/api/rec/settings/route";
import * as r3 from "@/app/api/rec/settings/logo/route";
import * as r4 from "@/app/api/rec/spaces/route";
import * as r5 from "@/lib/routes/rec/spaces/[id]/route";
import * as r6 from "@/lib/routes/rec/spaces/[id]/members/route";
import * as r7 from "@/app/api/rec/videos/route";
import * as r8 from "@/lib/routes/rec/videos/[id]/route";
import * as r9 from "@/lib/routes/rec/videos/[id]/analytics/route";
import * as r10 from "@/lib/routes/rec/videos/[id]/asset/route";
import * as r11 from "@/lib/routes/rec/videos/[id]/complete/route";
import * as r12 from "@/lib/routes/rec/videos/[id]/derive/route";
import * as r13 from "@/lib/routes/rec/videos/[id]/export/route";
import * as r14 from "@/lib/routes/rec/videos/[id]/file/route";
import * as r15 from "@/app/api/rec/videos/[id]/finalize/route";
import * as r16 from "@/lib/routes/rec/videos/[id]/later/route";
import * as r17 from "@/lib/routes/rec/videos/[id]/parts/route";
import * as r18 from "@/lib/routes/rec/videos/[id]/people/route";
import * as r19 from "@/lib/routes/rec/videos/[id]/recap/route";
import * as r20 from "@/lib/routes/rec/videos/[id]/requests/route";
import * as r21 from "@/lib/routes/rec/videos/[id]/requests/[rid]/route";
import * as r22 from "@/app/api/rec/videos/[id]/transcribe/route";

export const routes: Record<string, unknown> = {
  "/api/rec/folders": r0,
  "/api/rec/folders/[id]": r1,
  "/api/rec/settings": r2,
  "/api/rec/settings/logo": r3,
  "/api/rec/spaces": r4,
  "/api/rec/spaces/[id]": r5,
  "/api/rec/spaces/[id]/members": r6,
  "/api/rec/videos": r7,
  "/api/rec/videos/[id]": r8,
  "/api/rec/videos/[id]/analytics": r9,
  "/api/rec/videos/[id]/asset": r10,
  "/api/rec/videos/[id]/complete": r11,
  "/api/rec/videos/[id]/derive": r12,
  "/api/rec/videos/[id]/export": r13,
  "/api/rec/videos/[id]/file": r14,
  "/api/rec/videos/[id]/finalize": r15,
  "/api/rec/videos/[id]/later": r16,
  "/api/rec/videos/[id]/parts": r17,
  "/api/rec/videos/[id]/people": r18,
  "/api/rec/videos/[id]/recap": r19,
  "/api/rec/videos/[id]/requests": r20,
  "/api/rec/videos/[id]/requests/[rid]": r21,
  "/api/rec/videos/[id]/transcribe": r22,
};
