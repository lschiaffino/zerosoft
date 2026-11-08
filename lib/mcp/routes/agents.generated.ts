// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/agents/route";
import * as r1 from "@/app/api/agents/[id]/route";
import * as r2 from "@/lib/routes/agents/[id]/ab/route";
import * as r3 from "@/lib/routes/agents/[id]/access/route";
import * as r4 from "@/lib/routes/agents/[id]/analytics/route";
import * as r5 from "@/lib/routes/agents/[id]/approvals/route";
import * as r6 from "@/lib/routes/agents/[id]/approvals/[aid]/route";
import * as r7 from "@/lib/routes/agents/[id]/blocked/route";
import * as r8 from "@/lib/routes/agents/[id]/channels/route";
import * as r9 from "@/lib/routes/agents/[id]/conversations/route";
import * as r10 from "@/lib/routes/agents/[id]/conversations/[cid]/route";
import * as r11 from "@/app/api/agents/[id]/duplicate/route";
import * as r12 from "@/lib/routes/agents/[id]/export/route";
import * as r13 from "@/lib/routes/agents/[id]/feedback/route";
import * as r14 from "@/app/api/agents/[id]/files/route";
import * as r15 from "@/lib/routes/agents/[id]/files/[fid]/route";
import * as r16 from "@/lib/routes/agents/[id]/integrations/route";
import * as r17 from "@/app/api/agents/[id]/knowledge/route";
import * as r18 from "@/app/api/agents/[id]/mcp/route";
import * as r19 from "@/app/api/agents/[id]/mcp/[sid]/route";
import * as r20 from "@/lib/routes/agents/[id]/memories/[mid]/route";
import * as r21 from "@/app/api/agents/[id]/messages/route";
import * as r22 from "@/lib/routes/agents/[id]/qa/route";
import * as r23 from "@/lib/routes/agents/[id]/qa/[qid]/route";
import * as r24 from "@/app/api/agents/[id]/quality/route";
import * as r25 from "@/app/api/agents/[id]/replay/route";
import * as r26 from "@/lib/routes/agents/[id]/secrets/route";
import * as r27 from "@/lib/routes/agents/[id]/sources/route";
import * as r28 from "@/lib/routes/agents/[id]/suggestions/route";
import * as r29 from "@/lib/routes/agents/[id]/tests/route";
import * as r30 from "@/lib/routes/agents/[id]/tests/[tid]/route";
import * as r31 from "@/app/api/agents/[id]/tests/[tid]/run/route";
import * as r32 from "@/lib/routes/agents/[id]/versions/route";
import * as r33 from "@/lib/routes/agents/[id]/versions/[vid]/route";
import * as r34 from "@/lib/routes/agents/[id]/widgets/route";

export const routes: Record<string, unknown> = {
  "/api/agents": r0,
  "/api/agents/[id]": r1,
  "/api/agents/[id]/ab": r2,
  "/api/agents/[id]/access": r3,
  "/api/agents/[id]/analytics": r4,
  "/api/agents/[id]/approvals": r5,
  "/api/agents/[id]/approvals/[aid]": r6,
  "/api/agents/[id]/blocked": r7,
  "/api/agents/[id]/channels": r8,
  "/api/agents/[id]/conversations": r9,
  "/api/agents/[id]/conversations/[cid]": r10,
  "/api/agents/[id]/duplicate": r11,
  "/api/agents/[id]/export": r12,
  "/api/agents/[id]/feedback": r13,
  "/api/agents/[id]/files": r14,
  "/api/agents/[id]/files/[fid]": r15,
  "/api/agents/[id]/integrations": r16,
  "/api/agents/[id]/knowledge": r17,
  "/api/agents/[id]/mcp": r18,
  "/api/agents/[id]/mcp/[sid]": r19,
  "/api/agents/[id]/memories/[mid]": r20,
  "/api/agents/[id]/messages": r21,
  "/api/agents/[id]/qa": r22,
  "/api/agents/[id]/qa/[qid]": r23,
  "/api/agents/[id]/quality": r24,
  "/api/agents/[id]/replay": r25,
  "/api/agents/[id]/secrets": r26,
  "/api/agents/[id]/sources": r27,
  "/api/agents/[id]/suggestions": r28,
  "/api/agents/[id]/tests": r29,
  "/api/agents/[id]/tests/[tid]": r30,
  "/api/agents/[id]/tests/[tid]/run": r31,
  "/api/agents/[id]/versions": r32,
  "/api/agents/[id]/versions/[vid]": r33,
  "/api/agents/[id]/widgets": r34,
};
