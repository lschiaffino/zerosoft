// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/boards/route";
import * as r1 from "@/lib/routes/boards/[id]/route";
import * as r2 from "@/lib/routes/boards/[id]/access/route";
import * as r3 from "@/lib/routes/boards/[id]/ai/route";
import * as r4 from "@/lib/routes/boards/[id]/comments/route";
import * as r5 from "@/lib/routes/boards/[id]/comments/[threadId]/route";
import * as r6 from "@/lib/routes/boards/[id]/comments/[threadId]/[commentId]/route";
import * as r7 from "@/lib/routes/boards/[id]/duplicate/route";
import * as r8 from "@/lib/routes/boards/[id]/embed/route";
import * as r9 from "@/lib/routes/boards/[id]/files/route";
import * as r10 from "@/lib/routes/boards/[id]/files/[fileId]/route";
import * as r11 from "@/lib/routes/boards/[id]/history/route";
import * as r12 from "@/lib/routes/boards/[id]/history/[snapshotId]/route";
import * as r13 from "@/lib/routes/boards/[id]/scene/route";
import * as r14 from "@/lib/routes/boards/[id]/track/route";
import * as r15 from "@/lib/routes/boards/[id]/trash/route";
import * as r16 from "@/lib/routes/boards/[id]/version/route";
import * as r17 from "@/lib/routes/boards/[id]/workshop/route";
import * as r18 from "@/app/api/boards/audit/route";
import * as r19 from "@/app/api/boards/folders/route";
import * as r20 from "@/lib/routes/boards/folders/[folderId]/route";
import * as r21 from "@/app/api/boards/import/route";
import * as r22 from "@/app/api/boards/library/route";

export const routes: Record<string, unknown> = {
  "/api/boards": r0,
  "/api/boards/[id]": r1,
  "/api/boards/[id]/access": r2,
  "/api/boards/[id]/ai": r3,
  "/api/boards/[id]/comments": r4,
  "/api/boards/[id]/comments/[threadId]": r5,
  "/api/boards/[id]/comments/[threadId]/[commentId]": r6,
  "/api/boards/[id]/duplicate": r7,
  "/api/boards/[id]/embed": r8,
  "/api/boards/[id]/files": r9,
  "/api/boards/[id]/files/[fileId]": r10,
  "/api/boards/[id]/history": r11,
  "/api/boards/[id]/history/[snapshotId]": r12,
  "/api/boards/[id]/scene": r13,
  "/api/boards/[id]/track": r14,
  "/api/boards/[id]/trash": r15,
  "/api/boards/[id]/version": r16,
  "/api/boards/[id]/workshop": r17,
  "/api/boards/audit": r18,
  "/api/boards/folders": r19,
  "/api/boards/folders/[folderId]": r20,
  "/api/boards/import": r21,
  "/api/boards/library": r22,
};
