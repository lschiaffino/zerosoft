// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/groups/access/route";
import * as r1 from "@/app/api/groups/assignments/route";
import * as r2 from "@/app/api/groups/audit/route";
import * as r3 from "@/app/api/groups/availability/route";
import * as r4 from "@/app/api/groups/broadcasts/route";
import * as r5 from "@/lib/routes/groups/broadcasts/[id]/route";
import * as r6 from "@/app/api/groups/chats/route";
import * as r7 from "@/lib/routes/groups/chats/[id]/route";
import * as r8 from "@/app/api/groups/chats/[id]/draft/route";
import * as r9 from "@/lib/routes/groups/chats/[id]/group/route";
import * as r10 from "@/lib/routes/groups/chats/[id]/members/route";
import * as r11 from "@/lib/routes/groups/chats/[id]/messages/route";
import * as r12 from "@/app/api/groups/chats/[id]/summary/route";
import * as r13 from "@/app/api/groups/chats/[id]/translate/route";
import * as r14 from "@/app/api/groups/chats/bulk/route";
import * as r15 from "@/app/api/groups/create/route";
import * as r16 from "@/app/api/groups/export/route";
import * as r17 from "@/app/api/groups/integrations/route";
import * as r18 from "@/app/api/groups/join/route";
import * as r19 from "@/app/api/groups/labels/route";
import * as r20 from "@/lib/routes/groups/labels/[id]/route";
import * as r21 from "@/app/api/groups/lines/route";
import * as r22 from "@/app/api/groups/lists/route";
import * as r23 from "@/lib/routes/groups/lists/[id]/route";
import * as r24 from "@/lib/routes/groups/media/[id]/route";
import * as r25 from "@/app/api/groups/members/route";
import * as r26 from "@/lib/routes/groups/messages/[id]/route";
import * as r27 from "@/app/api/groups/numbers/route";
import * as r28 from "@/lib/routes/groups/numbers/[id]/route";
import * as r29 from "@/lib/routes/groups/numbers/[id]/connect/route";
import * as r30 from "@/app/api/groups/periskope/route";
import * as r31 from "@/app/api/groups/properties/route";
import * as r32 from "@/app/api/groups/push/route";
import * as r33 from "@/app/api/groups/push/test/route";
import * as r34 from "@/app/api/groups/quick-replies/route";
import * as r35 from "@/app/api/groups/recurring/route";
import * as r36 from "@/lib/routes/groups/recurring/[id]/route";
import * as r37 from "@/app/api/groups/rules/route";
import * as r38 from "@/lib/routes/groups/rules/[id]/route";
import * as r39 from "@/app/api/groups/sample/route";
import * as r40 from "@/app/api/groups/settings/route";
import * as r41 from "@/app/api/groups/tasks/route";
import * as r42 from "@/lib/routes/groups/tasks/[id]/route";
import * as r43 from "@/app/api/groups/team/route";
import * as r44 from "@/app/api/groups/teams/route";
import * as r45 from "@/lib/routes/groups/teams/[id]/route";
import * as r46 from "@/app/api/groups/templates/route";
import * as r47 from "@/lib/routes/groups/templates/[id]/route";
import * as r48 from "@/app/api/groups/templates/[id]/use/route";
import * as r49 from "@/app/api/groups/tickets/route";
import * as r50 from "@/lib/routes/groups/tickets/[id]/route";
import * as r51 from "@/app/api/groups/translate/route";
import * as r52 from "@/app/api/groups/upload/route";

export const routes: Record<string, unknown> = {
  "/api/groups/access": r0,
  "/api/groups/assignments": r1,
  "/api/groups/audit": r2,
  "/api/groups/availability": r3,
  "/api/groups/broadcasts": r4,
  "/api/groups/broadcasts/[id]": r5,
  "/api/groups/chats": r6,
  "/api/groups/chats/[id]": r7,
  "/api/groups/chats/[id]/draft": r8,
  "/api/groups/chats/[id]/group": r9,
  "/api/groups/chats/[id]/members": r10,
  "/api/groups/chats/[id]/messages": r11,
  "/api/groups/chats/[id]/summary": r12,
  "/api/groups/chats/[id]/translate": r13,
  "/api/groups/chats/bulk": r14,
  "/api/groups/create": r15,
  "/api/groups/export": r16,
  "/api/groups/integrations": r17,
  "/api/groups/join": r18,
  "/api/groups/labels": r19,
  "/api/groups/labels/[id]": r20,
  "/api/groups/lines": r21,
  "/api/groups/lists": r22,
  "/api/groups/lists/[id]": r23,
  "/api/groups/media/[id]": r24,
  "/api/groups/members": r25,
  "/api/groups/messages/[id]": r26,
  "/api/groups/numbers": r27,
  "/api/groups/numbers/[id]": r28,
  "/api/groups/numbers/[id]/connect": r29,
  "/api/groups/periskope": r30,
  "/api/groups/properties": r31,
  "/api/groups/push": r32,
  "/api/groups/push/test": r33,
  "/api/groups/quick-replies": r34,
  "/api/groups/recurring": r35,
  "/api/groups/recurring/[id]": r36,
  "/api/groups/rules": r37,
  "/api/groups/rules/[id]": r38,
  "/api/groups/sample": r39,
  "/api/groups/settings": r40,
  "/api/groups/tasks": r41,
  "/api/groups/tasks/[id]": r42,
  "/api/groups/team": r43,
  "/api/groups/teams": r44,
  "/api/groups/teams/[id]": r45,
  "/api/groups/templates": r46,
  "/api/groups/templates/[id]": r47,
  "/api/groups/templates/[id]/use": r48,
  "/api/groups/tickets": r49,
  "/api/groups/tickets/[id]": r50,
  "/api/groups/translate": r51,
  "/api/groups/upload": r52,
};
