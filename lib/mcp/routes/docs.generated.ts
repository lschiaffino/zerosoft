// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/docs/ai/route";
import * as r1 from "@/app/api/docs/ask/route";
import * as r2 from "@/app/api/docs/audit/route";
import * as r3 from "@/app/api/docs/databases/route";
import * as r4 from "@/lib/routes/docs/databases/[pageId]/[blockId]/route";
import * as r5 from "@/app/api/docs/databases/[pageId]/[blockId]/run/route";
import * as r6 from "@/lib/routes/docs/databases/[pageId]/[blockId]/runs/route";
import * as r7 from "@/app/api/docs/export/route";
import * as r8 from "@/app/api/docs/favorites/route";
import * as r9 from "@/lib/routes/docs/files/[pageId]/[blockId]/route";
import * as r10 from "@/app/api/docs/meetings/route";
import * as r11 from "@/lib/routes/docs/meetings/[id]/route";
import * as r12 from "@/app/api/docs/meetings/[id]/audio/route";
import * as r13 from "@/app/api/docs/meetings/[id]/summary/route";
import * as r14 from "@/lib/routes/docs/meetings/[id]/tasks/route";
import * as r15 from "@/app/api/docs/members/route";
import * as r16 from "@/app/api/docs/notion/route";
import * as r17 from "@/app/api/docs/notion/fake/route";
import * as r18 from "@/app/api/docs/notion/sync/route";
import * as r19 from "@/app/api/docs/pages/route";
import * as r20 from "@/lib/routes/docs/pages/[id]/route";
import * as r21 from "@/lib/routes/docs/pages/[id]/append/route";
import * as r22 from "@/app/api/docs/pages/[id]/autofill/route";
import * as r23 from "@/lib/routes/docs/pages/[id]/comments/route";
import * as r24 from "@/lib/routes/docs/pages/[id]/comments/[commentId]/route";
import * as r25 from "@/lib/routes/docs/pages/[id]/duplicate/route";
import * as r26 from "@/lib/routes/docs/pages/[id]/export/route";
import * as r27 from "@/lib/routes/docs/pages/[id]/files/route";
import * as r28 from "@/lib/routes/docs/pages/[id]/import/route";
import * as r29 from "@/lib/routes/docs/pages/[id]/live/route";
import * as r30 from "@/lib/routes/docs/pages/[id]/mentions/route";
import * as r31 from "@/lib/routes/docs/pages/[id]/site/route";
import * as r32 from "@/lib/routes/docs/pages/[id]/verify/route";
import * as r33 from "@/lib/routes/docs/pages/[id]/versions/route";
import * as r34 from "@/lib/routes/docs/pages/[id]/versions/[versionId]/route";
import * as r35 from "@/lib/routes/docs/pages/[id]/versions/[versionId]/restore/route";
import * as r36 from "@/lib/routes/docs/pages/[id]/views/route";
import * as r37 from "@/app/api/docs/search/route";
import * as r38 from "@/app/api/docs/settings/route";
import * as r39 from "@/app/api/docs/site/route";
import * as r40 from "@/app/api/docs/site/domain/route";
import * as r41 from "@/app/api/docs/sync/[id]/route";
import * as r42 from "@/lib/routes/docs/synced/[id]/route";
import * as r43 from "@/app/api/docs/teamspaces/route";
import * as r44 from "@/lib/routes/docs/teamspaces/[id]/route";
import * as r45 from "@/lib/routes/docs/teamspaces/[id]/members/route";
import * as r46 from "@/app/api/docs/templates/route";
import * as r47 from "@/app/api/docs/unfurl/route";

export const routes: Record<string, unknown> = {
  "/api/docs/ai": r0,
  "/api/docs/ask": r1,
  "/api/docs/audit": r2,
  "/api/docs/databases": r3,
  "/api/docs/databases/[pageId]/[blockId]": r4,
  "/api/docs/databases/[pageId]/[blockId]/run": r5,
  "/api/docs/databases/[pageId]/[blockId]/runs": r6,
  "/api/docs/export": r7,
  "/api/docs/favorites": r8,
  "/api/docs/files/[pageId]/[blockId]": r9,
  "/api/docs/meetings": r10,
  "/api/docs/meetings/[id]": r11,
  "/api/docs/meetings/[id]/audio": r12,
  "/api/docs/meetings/[id]/summary": r13,
  "/api/docs/meetings/[id]/tasks": r14,
  "/api/docs/members": r15,
  "/api/docs/notion": r16,
  "/api/docs/notion/fake": r17,
  "/api/docs/notion/sync": r18,
  "/api/docs/pages": r19,
  "/api/docs/pages/[id]": r20,
  "/api/docs/pages/[id]/append": r21,
  "/api/docs/pages/[id]/autofill": r22,
  "/api/docs/pages/[id]/comments": r23,
  "/api/docs/pages/[id]/comments/[commentId]": r24,
  "/api/docs/pages/[id]/duplicate": r25,
  "/api/docs/pages/[id]/export": r26,
  "/api/docs/pages/[id]/files": r27,
  "/api/docs/pages/[id]/import": r28,
  "/api/docs/pages/[id]/live": r29,
  "/api/docs/pages/[id]/mentions": r30,
  "/api/docs/pages/[id]/site": r31,
  "/api/docs/pages/[id]/verify": r32,
  "/api/docs/pages/[id]/versions": r33,
  "/api/docs/pages/[id]/versions/[versionId]": r34,
  "/api/docs/pages/[id]/versions/[versionId]/restore": r35,
  "/api/docs/pages/[id]/views": r36,
  "/api/docs/search": r37,
  "/api/docs/settings": r38,
  "/api/docs/site": r39,
  "/api/docs/site/domain": r40,
  "/api/docs/sync/[id]": r41,
  "/api/docs/synced/[id]": r42,
  "/api/docs/teamspaces": r43,
  "/api/docs/teamspaces/[id]": r44,
  "/api/docs/teamspaces/[id]/members": r45,
  "/api/docs/templates": r46,
  "/api/docs/unfurl": r47,
};
