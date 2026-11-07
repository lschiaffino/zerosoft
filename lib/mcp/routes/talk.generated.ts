// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/talk/admin/route";
import * as r1 from "@/app/api/talk/ai/route";
import * as r2 from "@/app/api/talk/bootstrap/route";
import * as r3 from "@/app/api/talk/canvas/route";
import * as r4 from "@/app/api/talk/channels/route";
import * as r5 from "@/lib/routes/talk/channels/[id]/route";
import * as r6 from "@/lib/routes/talk/channels/[id]/bookmarks/route";
import * as r7 from "@/lib/routes/talk/channels/[id]/members/route";
import * as r8 from "@/lib/routes/talk/channels/[id]/messages/route";
import * as r9 from "@/lib/routes/talk/channels/[id]/pins/route";
import * as r10 from "@/lib/routes/talk/channels/[id]/read/route";
import * as r11 from "@/lib/routes/talk/channels/[id]/typing/route";
import * as r12 from "@/app/api/talk/commands/run/route";
import * as r13 from "@/app/api/talk/dms/route";
import * as r14 from "@/app/api/talk/drafts/route";
import * as r15 from "@/app/api/talk/events/route";
import * as r16 from "@/app/api/talk/export/route";
import * as r17 from "@/app/api/talk/files/route";
import * as r18 from "@/lib/routes/talk/files/[id]/route";
import * as r19 from "@/app/api/talk/guests/route";
import * as r20 from "@/app/api/talk/huddles/route";
import * as r21 from "@/app/api/talk/lists/route";
import * as r22 from "@/app/api/talk/me/route";
import * as r23 from "@/app/api/talk/messages/route";
import * as r24 from "@/lib/routes/talk/messages/[id]/route";
import * as r25 from "@/lib/routes/talk/messages/[id]/issue/route";
import * as r26 from "@/lib/routes/talk/messages/[id]/pin/route";
import * as r27 from "@/lib/routes/talk/messages/[id]/reactions/route";
import * as r28 from "@/lib/routes/talk/messages/[id]/save/route";
import * as r29 from "@/app/api/talk/profile/route";
import * as r30 from "@/app/api/talk/reminders/route";
import * as r31 from "@/app/api/talk/scheduled/route";
import * as r32 from "@/lib/routes/talk/scheduled/[id]/route";
import * as r33 from "@/app/api/talk/search/route";
import * as r34 from "@/app/api/talk/sections/route";
import * as r35 from "@/app/api/talk/views/route";
import * as r36 from "@/app/api/talk/workspace/route";

export const routes: Record<string, unknown> = {
  "/api/talk/admin": r0,
  "/api/talk/ai": r1,
  "/api/talk/bootstrap": r2,
  "/api/talk/canvas": r3,
  "/api/talk/channels": r4,
  "/api/talk/channels/[id]": r5,
  "/api/talk/channels/[id]/bookmarks": r6,
  "/api/talk/channels/[id]/members": r7,
  "/api/talk/channels/[id]/messages": r8,
  "/api/talk/channels/[id]/pins": r9,
  "/api/talk/channels/[id]/read": r10,
  "/api/talk/channels/[id]/typing": r11,
  "/api/talk/commands/run": r12,
  "/api/talk/dms": r13,
  "/api/talk/drafts": r14,
  "/api/talk/events": r15,
  "/api/talk/export": r16,
  "/api/talk/files": r17,
  "/api/talk/files/[id]": r18,
  "/api/talk/guests": r19,
  "/api/talk/huddles": r20,
  "/api/talk/lists": r21,
  "/api/talk/me": r22,
  "/api/talk/messages": r23,
  "/api/talk/messages/[id]": r24,
  "/api/talk/messages/[id]/issue": r25,
  "/api/talk/messages/[id]/pin": r26,
  "/api/talk/messages/[id]/reactions": r27,
  "/api/talk/messages/[id]/save": r28,
  "/api/talk/profile": r29,
  "/api/talk/reminders": r30,
  "/api/talk/scheduled": r31,
  "/api/talk/scheduled/[id]": r32,
  "/api/talk/search": r33,
  "/api/talk/sections": r34,
  "/api/talk/views": r35,
  "/api/talk/workspace": r36,
};
