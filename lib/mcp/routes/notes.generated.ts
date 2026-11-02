// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/notes/route";
import * as r1 from "@/lib/routes/notes/[id]/route";
import * as r2 from "@/lib/routes/notes/[id]/access/route";
import * as r3 from "@/lib/routes/notes/[id]/export/route";
import * as r4 from "@/lib/routes/notes/[id]/file-text/route";
import * as r5 from "@/lib/routes/notes/[id]/files/route";
import * as r6 from "@/lib/routes/notes/[id]/files/[blockId]/route";
import * as r7 from "@/lib/routes/notes/[id]/lock/route";
import * as r8 from "@/lib/routes/notes/[id]/reminder/route";
import * as r9 from "@/lib/routes/notes/[id]/shares/route";
import * as r10 from "@/lib/routes/notes/[id]/tasks/route";
import * as r11 from "@/lib/routes/notes/[id]/track/route";
import * as r12 from "@/lib/routes/notes/[id]/transcribe/route";
import * as r13 from "@/lib/routes/notes/[id]/versions/route";
import * as r14 from "@/lib/routes/notes/[id]/versions/[versionId]/route";
import * as r15 from "@/lib/routes/notes/[id]/versions/[versionId]/restore/route";
import * as r16 from "@/app/api/notes/admin/route";
import * as r17 from "@/app/api/notes/ai/route";
import * as r18 from "@/app/api/notes/ask/route";
import * as r19 from "@/app/api/notes/bulk/route";
import * as r20 from "@/app/api/notes/clip/route";
import * as r21 from "@/app/api/notes/email-address/route";
import * as r22 from "@/app/api/notes/events/route";
import * as r23 from "@/app/api/notes/export/route";
import * as r24 from "@/app/api/notes/import/route";
import * as r25 from "@/app/api/notes/notebooks/route";
import * as r26 from "@/lib/routes/notes/notebooks/[id]/route";
import * as r27 from "@/lib/routes/notes/notebooks/[id]/shares/route";
import * as r28 from "@/app/api/notes/prefs/route";
import * as r29 from "@/app/api/notes/searches/route";
import * as r30 from "@/lib/routes/notes/searches/[id]/route";
import * as r31 from "@/app/api/notes/semantic/route";
import * as r32 from "@/app/api/notes/stacks/route";
import * as r33 from "@/app/api/notes/sync/route";
import * as r34 from "@/app/api/notes/tags/route";
import * as r35 from "@/app/api/notes/tasks/route";
import * as r36 from "@/app/api/notes/templates/route";
import * as r37 from "@/lib/routes/notes/templates/[id]/route";
import * as r38 from "@/app/api/notes/trash/route";

export const routes: Record<string, unknown> = {
  "/api/notes": r0,
  "/api/notes/[id]": r1,
  "/api/notes/[id]/access": r2,
  "/api/notes/[id]/export": r3,
  "/api/notes/[id]/file-text": r4,
  "/api/notes/[id]/files": r5,
  "/api/notes/[id]/files/[blockId]": r6,
  "/api/notes/[id]/lock": r7,
  "/api/notes/[id]/reminder": r8,
  "/api/notes/[id]/shares": r9,
  "/api/notes/[id]/tasks": r10,
  "/api/notes/[id]/track": r11,
  "/api/notes/[id]/transcribe": r12,
  "/api/notes/[id]/versions": r13,
  "/api/notes/[id]/versions/[versionId]": r14,
  "/api/notes/[id]/versions/[versionId]/restore": r15,
  "/api/notes/admin": r16,
  "/api/notes/ai": r17,
  "/api/notes/ask": r18,
  "/api/notes/bulk": r19,
  "/api/notes/clip": r20,
  "/api/notes/email-address": r21,
  "/api/notes/events": r22,
  "/api/notes/export": r23,
  "/api/notes/import": r24,
  "/api/notes/notebooks": r25,
  "/api/notes/notebooks/[id]": r26,
  "/api/notes/notebooks/[id]/shares": r27,
  "/api/notes/prefs": r28,
  "/api/notes/searches": r29,
  "/api/notes/searches/[id]": r30,
  "/api/notes/semantic": r31,
  "/api/notes/stacks": r32,
  "/api/notes/sync": r33,
  "/api/notes/tags": r34,
  "/api/notes/tasks": r35,
  "/api/notes/templates": r36,
  "/api/notes/templates/[id]": r37,
  "/api/notes/trash": r38,
};
