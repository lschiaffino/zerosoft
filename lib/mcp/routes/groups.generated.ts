// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/groups/access/route";
import * as r1 from "@/app/api/groups/analytics/route";
import * as r2 from "@/app/api/groups/assignments/route";
import * as r3 from "@/app/api/groups/audit/route";
import * as r4 from "@/app/api/groups/availability/route";
import * as r5 from "@/app/api/groups/brief/route";
import * as r6 from "@/app/api/groups/broadcasts/route";
import * as r7 from "@/lib/routes/groups/broadcasts/[id]/route";
import * as r8 from "@/app/api/groups/chats/route";
import * as r9 from "@/lib/routes/groups/chats/[id]/route";
import * as r10 from "@/app/api/groups/chats/[id]/draft/route";
import * as r11 from "@/lib/routes/groups/chats/[id]/group/route";
import * as r12 from "@/lib/routes/groups/chats/[id]/members/route";
import * as r13 from "@/lib/routes/groups/chats/[id]/messages/route";
import * as r14 from "@/app/api/groups/chats/[id]/summary/route";
import * as r15 from "@/app/api/groups/chats/[id]/translate/route";
import * as r16 from "@/app/api/groups/chats/bulk/route";
import * as r17 from "@/app/api/groups/contacts/route";
import * as r18 from "@/app/api/groups/create/route";
import * as r19 from "@/app/api/groups/export/route";
import * as r20 from "@/app/api/groups/folders/route";
import * as r21 from "@/app/api/groups/gifs/route";
import * as r22 from "@/app/api/groups/hubspot/route";
import * as r23 from "@/app/api/groups/hubspot/company/route";
import * as r24 from "@/app/api/groups/hubspot/links/route";
import * as r25 from "@/app/api/groups/hubspot/log/route";
import * as r26 from "@/app/api/groups/hubspot/properties/route";
import * as r27 from "@/app/api/groups/hubspot/search/route";
import * as r28 from "@/app/api/groups/hubspot/sync/route";
import * as r29 from "@/app/api/groups/hubspot/tickets/route";
import * as r30 from "@/app/api/groups/hubspot/unlinked/route";
import * as r31 from "@/app/api/groups/integrations/route";
import * as r32 from "@/app/api/groups/join/route";
import * as r33 from "@/app/api/groups/kanban/route";
import * as r34 from "@/app/api/groups/kanban/move/route";
import * as r35 from "@/app/api/groups/kanban/stages/route";
import * as r36 from "@/app/api/groups/labels/route";
import * as r37 from "@/lib/routes/groups/labels/[id]/route";
import * as r38 from "@/app/api/groups/line-groups/route";
import * as r39 from "@/app/api/groups/lists/route";
import * as r40 from "@/lib/routes/groups/lists/[id]/route";
import * as r41 from "@/lib/routes/groups/media/[id]/route";
import * as r42 from "@/app/api/groups/members/route";
import * as r43 from "@/lib/routes/groups/messages/[id]/route";
import * as r44 from "@/lib/routes/groups/messages/[id]/transcript/route";
import * as r45 from "@/app/api/groups/numbers/route";
import * as r46 from "@/lib/routes/groups/numbers/[id]/route";
import * as r47 from "@/lib/routes/groups/numbers/[id]/connect/route";
import * as r48 from "@/app/api/groups/people/route";
import * as r49 from "@/app/api/groups/people/person/route";
import * as r50 from "@/app/api/groups/prefs/route";
import * as r51 from "@/app/api/groups/properties/route";
import * as r52 from "@/app/api/groups/push/route";
import * as r53 from "@/app/api/groups/push/test/route";
import * as r54 from "@/app/api/groups/quick-replies/route";
import * as r55 from "@/app/api/groups/recurring/route";
import * as r56 from "@/lib/routes/groups/recurring/[id]/route";
import * as r57 from "@/app/api/groups/rules/route";
import * as r58 from "@/lib/routes/groups/rules/[id]/route";
import * as r59 from "@/app/api/groups/sample/route";
import * as r60 from "@/app/api/groups/settings/route";
import * as r61 from "@/app/api/groups/stickers/route";
import * as r62 from "@/app/api/groups/table/route";
import * as r63 from "@/app/api/groups/tasks/route";
import * as r64 from "@/lib/routes/groups/tasks/[id]/route";
import * as r65 from "@/app/api/groups/teams/route";
import * as r66 from "@/lib/routes/groups/teams/[id]/route";
import * as r67 from "@/app/api/groups/templates/route";
import * as r68 from "@/lib/routes/groups/templates/[id]/route";
import * as r69 from "@/app/api/groups/templates/[id]/use/route";
import * as r70 from "@/app/api/groups/tickets/route";
import * as r71 from "@/lib/routes/groups/tickets/[id]/route";
import * as r72 from "@/app/api/groups/translate/route";
import * as r73 from "@/app/api/groups/upload/route";

export const routes: Record<string, unknown> = {
  "/api/groups/access": r0,
  "/api/groups/analytics": r1,
  "/api/groups/assignments": r2,
  "/api/groups/audit": r3,
  "/api/groups/availability": r4,
  "/api/groups/brief": r5,
  "/api/groups/broadcasts": r6,
  "/api/groups/broadcasts/[id]": r7,
  "/api/groups/chats": r8,
  "/api/groups/chats/[id]": r9,
  "/api/groups/chats/[id]/draft": r10,
  "/api/groups/chats/[id]/group": r11,
  "/api/groups/chats/[id]/members": r12,
  "/api/groups/chats/[id]/messages": r13,
  "/api/groups/chats/[id]/summary": r14,
  "/api/groups/chats/[id]/translate": r15,
  "/api/groups/chats/bulk": r16,
  "/api/groups/contacts": r17,
  "/api/groups/create": r18,
  "/api/groups/export": r19,
  "/api/groups/folders": r20,
  "/api/groups/gifs": r21,
  "/api/groups/hubspot": r22,
  "/api/groups/hubspot/company": r23,
  "/api/groups/hubspot/links": r24,
  "/api/groups/hubspot/log": r25,
  "/api/groups/hubspot/properties": r26,
  "/api/groups/hubspot/search": r27,
  "/api/groups/hubspot/sync": r28,
  "/api/groups/hubspot/tickets": r29,
  "/api/groups/hubspot/unlinked": r30,
  "/api/groups/integrations": r31,
  "/api/groups/join": r32,
  "/api/groups/kanban": r33,
  "/api/groups/kanban/move": r34,
  "/api/groups/kanban/stages": r35,
  "/api/groups/labels": r36,
  "/api/groups/labels/[id]": r37,
  "/api/groups/line-groups": r38,
  "/api/groups/lists": r39,
  "/api/groups/lists/[id]": r40,
  "/api/groups/media/[id]": r41,
  "/api/groups/members": r42,
  "/api/groups/messages/[id]": r43,
  "/api/groups/messages/[id]/transcript": r44,
  "/api/groups/numbers": r45,
  "/api/groups/numbers/[id]": r46,
  "/api/groups/numbers/[id]/connect": r47,
  "/api/groups/people": r48,
  "/api/groups/people/person": r49,
  "/api/groups/prefs": r50,
  "/api/groups/properties": r51,
  "/api/groups/push": r52,
  "/api/groups/push/test": r53,
  "/api/groups/quick-replies": r54,
  "/api/groups/recurring": r55,
  "/api/groups/recurring/[id]": r56,
  "/api/groups/rules": r57,
  "/api/groups/rules/[id]": r58,
  "/api/groups/sample": r59,
  "/api/groups/settings": r60,
  "/api/groups/stickers": r61,
  "/api/groups/table": r62,
  "/api/groups/tasks": r63,
  "/api/groups/tasks/[id]": r64,
  "/api/groups/teams": r65,
  "/api/groups/teams/[id]": r66,
  "/api/groups/templates": r67,
  "/api/groups/templates/[id]": r68,
  "/api/groups/templates/[id]/use": r69,
  "/api/groups/tickets": r70,
  "/api/groups/tickets/[id]": r71,
  "/api/groups/translate": r72,
  "/api/groups/upload": r73,
};
