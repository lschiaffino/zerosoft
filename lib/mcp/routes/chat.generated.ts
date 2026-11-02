// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/chat/agent-status/route";
import * as r1 from "@/app/api/chat/audit/route";
import * as r2 from "@/app/api/chat/campaigns/route";
import * as r3 from "@/lib/routes/chat/campaigns/[id]/route";
import * as r4 from "@/lib/routes/chat/canned/[id]/route";
import * as r5 from "@/app/api/chat/companies/route";
import * as r6 from "@/lib/routes/chat/companies/[id]/route";
import * as r7 from "@/app/api/chat/conversations/route";
import * as r8 from "@/lib/routes/chat/conversations/[id]/route";
import * as r9 from "@/lib/routes/chat/conversations/[id]/attachments/route";
import * as r10 from "@/lib/routes/chat/conversations/[id]/copilot/route";
import * as r11 from "@/lib/routes/chat/conversations/[id]/crm/route";
import * as r12 from "@/lib/routes/chat/conversations/[id]/follow/route";
import * as r13 from "@/lib/routes/chat/conversations/[id]/macro/route";
import * as r14 from "@/lib/routes/chat/conversations/[id]/merge/route";
import * as r15 from "@/lib/routes/chat/conversations/[id]/messages/route";
import * as r16 from "@/lib/routes/chat/conversations/[id]/messages/[messageId]/route";
import * as r17 from "@/lib/routes/chat/conversations/[id]/presence/route";
import * as r18 from "@/lib/routes/chat/conversations/[id]/read/route";
import * as r19 from "@/lib/routes/chat/conversations/[id]/tags/route";
import * as r20 from "@/lib/routes/chat/conversations/[id]/track/route";
import * as r21 from "@/lib/routes/chat/conversations/[id]/transcript/route";
import * as r22 from "@/lib/routes/chat/conversations/[id]/typing/route";
import * as r23 from "@/app/api/chat/conversations/bulk/route";
import * as r24 from "@/app/api/chat/custom-reports/route";
import * as r25 from "@/lib/routes/chat/custom-reports/[id]/route";
import * as r26 from "@/app/api/chat/export/route";
import * as r27 from "@/app/api/chat/import/route";
import * as r28 from "@/app/api/chat/inbound-email/route";
import * as r29 from "@/lib/routes/chat/outbound/[id]/route";
import * as r30 from "@/app/api/chat/reports/route";
import * as r31 from "@/app/api/chat/routing/route";
import * as r32 from "@/lib/routes/chat/rules/[id]/route";
import * as r33 from "@/lib/routes/chat/rules/[id]/reorder/route";
import * as r34 from "@/app/api/chat/tags/route";
import * as r35 from "@/app/api/chat/teams/route";
import * as r36 from "@/lib/routes/chat/teams/[id]/route";
import * as r37 from "@/app/api/chat/views/route";
import * as r38 from "@/lib/routes/chat/views/[id]/route";
import * as r39 from "@/app/api/chat/visitors/route";
import * as r40 from "@/lib/routes/chat/visitors/[id]/route";
import * as r41 from "@/app/api/chat/widgets/route";
import * as r42 from "@/lib/routes/chat/widgets/[id]/route";
import * as r43 from "@/lib/routes/chat/widgets/[id]/access/route";
import * as r44 from "@/lib/routes/chat/widgets/[id]/canned/route";
import * as r45 from "@/lib/routes/chat/widgets/[id]/email/route";
import * as r46 from "@/lib/routes/chat/widgets/[id]/outbound/route";
import * as r47 from "@/lib/routes/chat/widgets/[id]/rules/route";
import * as r48 from "@/lib/routes/chat/widgets/[id]/sla/route";

export const routes: Record<string, unknown> = {
  "/api/chat/agent-status": r0,
  "/api/chat/audit": r1,
  "/api/chat/campaigns": r2,
  "/api/chat/campaigns/[id]": r3,
  "/api/chat/canned/[id]": r4,
  "/api/chat/companies": r5,
  "/api/chat/companies/[id]": r6,
  "/api/chat/conversations": r7,
  "/api/chat/conversations/[id]": r8,
  "/api/chat/conversations/[id]/attachments": r9,
  "/api/chat/conversations/[id]/copilot": r10,
  "/api/chat/conversations/[id]/crm": r11,
  "/api/chat/conversations/[id]/follow": r12,
  "/api/chat/conversations/[id]/macro": r13,
  "/api/chat/conversations/[id]/merge": r14,
  "/api/chat/conversations/[id]/messages": r15,
  "/api/chat/conversations/[id]/messages/[messageId]": r16,
  "/api/chat/conversations/[id]/presence": r17,
  "/api/chat/conversations/[id]/read": r18,
  "/api/chat/conversations/[id]/tags": r19,
  "/api/chat/conversations/[id]/track": r20,
  "/api/chat/conversations/[id]/transcript": r21,
  "/api/chat/conversations/[id]/typing": r22,
  "/api/chat/conversations/bulk": r23,
  "/api/chat/custom-reports": r24,
  "/api/chat/custom-reports/[id]": r25,
  "/api/chat/export": r26,
  "/api/chat/import": r27,
  "/api/chat/inbound-email": r28,
  "/api/chat/outbound/[id]": r29,
  "/api/chat/reports": r30,
  "/api/chat/routing": r31,
  "/api/chat/rules/[id]": r32,
  "/api/chat/rules/[id]/reorder": r33,
  "/api/chat/tags": r34,
  "/api/chat/teams": r35,
  "/api/chat/teams/[id]": r36,
  "/api/chat/views": r37,
  "/api/chat/views/[id]": r38,
  "/api/chat/visitors": r39,
  "/api/chat/visitors/[id]": r40,
  "/api/chat/widgets": r41,
  "/api/chat/widgets/[id]": r42,
  "/api/chat/widgets/[id]/access": r43,
  "/api/chat/widgets/[id]/canned": r44,
  "/api/chat/widgets/[id]/email": r45,
  "/api/chat/widgets/[id]/outbound": r46,
  "/api/chat/widgets/[id]/rules": r47,
  "/api/chat/widgets/[id]/sla": r48,
};
