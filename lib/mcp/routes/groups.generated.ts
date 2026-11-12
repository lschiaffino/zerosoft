// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/groups/access/route";
import * as r1 from "@/app/api/groups/analytics/route";
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
import * as r15 from "@/app/api/groups/contacts/route";
import * as r16 from "@/app/api/groups/create/route";
import * as r17 from "@/app/api/groups/export/route";
import * as r18 from "@/app/api/groups/folders/route";
import * as r19 from "@/app/api/groups/hubspot/route";
import * as r20 from "@/app/api/groups/hubspot/company/route";
import * as r21 from "@/app/api/groups/hubspot/links/route";
import * as r22 from "@/app/api/groups/hubspot/log/route";
import * as r23 from "@/app/api/groups/hubspot/properties/route";
import * as r24 from "@/app/api/groups/hubspot/search/route";
import * as r25 from "@/app/api/groups/hubspot/unlinked/route";
import * as r26 from "@/app/api/groups/integrations/route";
import * as r27 from "@/app/api/groups/join/route";
import * as r28 from "@/app/api/groups/labels/route";
import * as r29 from "@/lib/routes/groups/labels/[id]/route";
import * as r30 from "@/app/api/groups/lists/route";
import * as r31 from "@/lib/routes/groups/lists/[id]/route";
import * as r32 from "@/lib/routes/groups/media/[id]/route";
import * as r33 from "@/app/api/groups/members/route";
import * as r34 from "@/lib/routes/groups/messages/[id]/route";
import * as r35 from "@/lib/routes/groups/messages/[id]/transcript/route";
import * as r36 from "@/app/api/groups/numbers/route";
import * as r37 from "@/lib/routes/groups/numbers/[id]/route";
import * as r38 from "@/lib/routes/groups/numbers/[id]/connect/route";
import * as r39 from "@/app/api/groups/prefs/route";
import * as r40 from "@/app/api/groups/properties/route";
import * as r41 from "@/app/api/groups/push/route";
import * as r42 from "@/app/api/groups/push/test/route";
import * as r43 from "@/app/api/groups/quick-replies/route";
import * as r44 from "@/app/api/groups/recurring/route";
import * as r45 from "@/lib/routes/groups/recurring/[id]/route";
import * as r46 from "@/app/api/groups/rules/route";
import * as r47 from "@/lib/routes/groups/rules/[id]/route";
import * as r48 from "@/app/api/groups/sample/route";
import * as r49 from "@/app/api/groups/settings/route";
import * as r50 from "@/app/api/groups/tasks/route";
import * as r51 from "@/lib/routes/groups/tasks/[id]/route";
import * as r52 from "@/app/api/groups/teams/route";
import * as r53 from "@/lib/routes/groups/teams/[id]/route";
import * as r54 from "@/app/api/groups/templates/route";
import * as r55 from "@/lib/routes/groups/templates/[id]/route";
import * as r56 from "@/app/api/groups/templates/[id]/use/route";
import * as r57 from "@/app/api/groups/tickets/route";
import * as r58 from "@/lib/routes/groups/tickets/[id]/route";
import * as r59 from "@/app/api/groups/translate/route";
import * as r60 from "@/app/api/groups/upload/route";

export const routes: Record<string, unknown> = {
  "/api/groups/access": r0,
  "/api/groups/analytics": r1,
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
  "/api/groups/contacts": r15,
  "/api/groups/create": r16,
  "/api/groups/export": r17,
  "/api/groups/folders": r18,
  "/api/groups/hubspot": r19,
  "/api/groups/hubspot/company": r20,
  "/api/groups/hubspot/links": r21,
  "/api/groups/hubspot/log": r22,
  "/api/groups/hubspot/properties": r23,
  "/api/groups/hubspot/search": r24,
  "/api/groups/hubspot/unlinked": r25,
  "/api/groups/integrations": r26,
  "/api/groups/join": r27,
  "/api/groups/labels": r28,
  "/api/groups/labels/[id]": r29,
  "/api/groups/lists": r30,
  "/api/groups/lists/[id]": r31,
  "/api/groups/media/[id]": r32,
  "/api/groups/members": r33,
  "/api/groups/messages/[id]": r34,
  "/api/groups/messages/[id]/transcript": r35,
  "/api/groups/numbers": r36,
  "/api/groups/numbers/[id]": r37,
  "/api/groups/numbers/[id]/connect": r38,
  "/api/groups/prefs": r39,
  "/api/groups/properties": r40,
  "/api/groups/push": r41,
  "/api/groups/push/test": r42,
  "/api/groups/quick-replies": r43,
  "/api/groups/recurring": r44,
  "/api/groups/recurring/[id]": r45,
  "/api/groups/rules": r46,
  "/api/groups/rules/[id]": r47,
  "/api/groups/sample": r48,
  "/api/groups/settings": r49,
  "/api/groups/tasks": r50,
  "/api/groups/tasks/[id]": r51,
  "/api/groups/teams": r52,
  "/api/groups/teams/[id]": r53,
  "/api/groups/templates": r54,
  "/api/groups/templates/[id]": r55,
  "/api/groups/templates/[id]/use": r56,
  "/api/groups/tickets": r57,
  "/api/groups/tickets/[id]": r58,
  "/api/groups/translate": r59,
  "/api/groups/upload": r60,
};
