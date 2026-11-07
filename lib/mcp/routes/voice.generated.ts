// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/voice/ask/route";
import * as r1 from "@/app/api/voice/bookings/route";
import * as r2 from "@/app/api/voice/brief/route";
import * as r3 from "@/app/api/voice/command/route";
import * as r4 from "@/app/api/voice/dictate/route";
import * as r5 from "@/app/api/voice/dictionary/route";
import * as r6 from "@/lib/routes/voice/dictionary/[id]/route";
import * as r7 from "@/app/api/voice/folders/route";
import * as r8 from "@/lib/routes/voice/folders/[id]/route";
import * as r9 from "@/app/api/voice/prompts/route";
import * as r10 from "@/lib/routes/voice/prompts/[id]/route";
import * as r11 from "@/app/api/voice/send-targets/route";
import * as r12 from "@/app/api/voice/sessions/route";
import * as r13 from "@/lib/routes/voice/sessions/[id]/route";
import * as r14 from "@/app/api/voice/sessions/[id]/assist/route";
import * as r15 from "@/app/api/voice/sessions/[id]/chat/route";
import * as r16 from "@/app/api/voice/sessions/[id]/chunks/route";
import * as r17 from "@/lib/routes/voice/sessions/[id]/close/route";
import * as r18 from "@/app/api/voice/sessions/[id]/enhance/route";
import * as r19 from "@/app/api/voice/sessions/[id]/file/route";
import * as r20 from "@/lib/routes/voice/sessions/[id]/heartbeat/route";
import * as r21 from "@/lib/routes/voice/sessions/[id]/link/route";
import * as r22 from "@/lib/routes/voice/sessions/[id]/send/route";
import * as r23 from "@/lib/routes/voice/sessions/[id]/share/route";
import * as r24 from "@/app/api/voice/settings/route";
import * as r25 from "@/app/api/voice/shared/route";
import * as r26 from "@/app/api/voice/templates/route";
import * as r27 from "@/lib/routes/voice/templates/[id]/route";
import * as r28 from "@/app/api/voice/usage/route";
import * as r29 from "@/app/api/voice/workspace/route";

export const routes: Record<string, unknown> = {
  "/api/voice/ask": r0,
  "/api/voice/bookings": r1,
  "/api/voice/brief": r2,
  "/api/voice/command": r3,
  "/api/voice/dictate": r4,
  "/api/voice/dictionary": r5,
  "/api/voice/dictionary/[id]": r6,
  "/api/voice/folders": r7,
  "/api/voice/folders/[id]": r8,
  "/api/voice/prompts": r9,
  "/api/voice/prompts/[id]": r10,
  "/api/voice/send-targets": r11,
  "/api/voice/sessions": r12,
  "/api/voice/sessions/[id]": r13,
  "/api/voice/sessions/[id]/assist": r14,
  "/api/voice/sessions/[id]/chat": r15,
  "/api/voice/sessions/[id]/chunks": r16,
  "/api/voice/sessions/[id]/close": r17,
  "/api/voice/sessions/[id]/enhance": r18,
  "/api/voice/sessions/[id]/file": r19,
  "/api/voice/sessions/[id]/heartbeat": r20,
  "/api/voice/sessions/[id]/link": r21,
  "/api/voice/sessions/[id]/send": r22,
  "/api/voice/sessions/[id]/share": r23,
  "/api/voice/settings": r24,
  "/api/voice/shared": r25,
  "/api/voice/templates": r26,
  "/api/voice/templates/[id]": r27,
  "/api/voice/usage": r28,
  "/api/voice/workspace": r29,
};
