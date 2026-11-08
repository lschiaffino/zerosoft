// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/track/access/route";
import * as r1 from "@/lib/routes/track/agent-sessions/[id]/route";
import * as r2 from "@/app/api/track/archive/route";
import * as r3 from "@/app/api/track/audit/route";
import * as r4 from "@/lib/routes/track/customer-requests/[id]/route";
import * as r5 from "@/app/api/track/customers/route";
import * as r6 from "@/app/api/track/customers/search/route";
import * as r7 from "@/app/api/track/cycles/route";
import * as r8 from "@/lib/routes/track/cycles/[id]/route";
import * as r9 from "@/lib/routes/track/cycles/[id]/complete/route";
import * as r10 from "@/lib/routes/track/cycles/[id]/metrics/route";
import * as r11 from "@/lib/routes/track/dashboard-widgets/[id]/route";
import * as r12 from "@/app/api/track/dashboards/route";
import * as r13 from "@/lib/routes/track/dashboards/[id]/route";
import * as r14 from "@/lib/routes/track/dashboards/[id]/widgets/route";
import * as r15 from "@/app/api/track/export/route";
import * as r16 from "@/app/api/track/github/rules/route";
import * as r17 from "@/app/api/track/initiatives/route";
import * as r18 from "@/lib/routes/track/initiatives/[id]/route";
import * as r19 from "@/app/api/track/insights/route";
import * as r20 from "@/app/api/track/integrations/route";
import * as r21 from "@/app/api/track/integrations/slack/channels/route";
import * as r22 from "@/app/api/track/issues/route";
import * as r23 from "@/lib/routes/track/issues/[id]/route";
import * as r24 from "@/lib/routes/track/issues/[id]/activities/route";
import * as r25 from "@/lib/routes/track/issues/[id]/agent/route";
import * as r26 from "@/lib/routes/track/issues/[id]/ai/suggestions/route";
import * as r27 from "@/lib/routes/track/issues/[id]/ai/suggestions/[sid]/route";
import * as r28 from "@/lib/routes/track/issues/[id]/ai/summary/route";
import * as r29 from "@/lib/routes/track/issues/[id]/attachments/route";
import * as r30 from "@/lib/routes/track/issues/[id]/attachments/[fileId]/route";
import * as r31 from "@/lib/routes/track/issues/[id]/attachments/finalize/route";
import * as r32 from "@/lib/routes/track/issues/[id]/attachments/upload/route";
import * as r33 from "@/lib/routes/track/issues/[id]/children/route";
import * as r34 from "@/lib/routes/track/issues/[id]/comments/route";
import * as r35 from "@/lib/routes/track/issues/[id]/comments/[commentId]/route";
import * as r36 from "@/lib/routes/track/issues/[id]/comments/[commentId]/reactions/route";
import * as r37 from "@/lib/routes/track/issues/[id]/comments/[commentId]/resolve/route";
import * as r38 from "@/lib/routes/track/issues/[id]/customer-requests/route";
import * as r39 from "@/lib/routes/track/issues/[id]/duplicates/route";
import * as r40 from "@/lib/routes/track/issues/[id]/favorite/route";
import * as r41 from "@/lib/routes/track/issues/[id]/github/route";
import * as r42 from "@/lib/routes/track/issues/[id]/insights/route";
import * as r43 from "@/lib/routes/track/issues/[id]/links/route";
import * as r44 from "@/lib/routes/track/issues/[id]/move/route";
import * as r45 from "@/lib/routes/track/issues/[id]/relations/route";
import * as r46 from "@/lib/routes/track/issues/[id]/reminder/route";
import * as r47 from "@/lib/routes/track/issues/[id]/snooze/route";
import * as r48 from "@/lib/routes/track/issues/[id]/subscription/route";
import * as r49 from "@/lib/routes/track/issues/[id]/triage/route";
import * as r50 from "@/app/api/track/issues/bulk/route";
import * as r51 from "@/app/api/track/issues/favorites/route";
import * as r52 from "@/app/api/track/labels/route";
import * as r53 from "@/lib/routes/track/labels/[id]/route";
import * as r54 from "@/app/api/track/list-views/route";
import * as r55 from "@/app/api/track/live/route";
import * as r56 from "@/lib/routes/track/milestones/[id]/route";
import * as r57 from "@/app/api/track/notify-prefs/route";
import * as r58 from "@/lib/routes/track/plan-milestones/[id]/route";
import * as r59 from "@/lib/routes/track/plan-updates/[id]/route";
import * as r60 from "@/lib/routes/track/plan-updates/[id]/comments/route";
import * as r61 from "@/app/api/track/plans/route";
import * as r62 from "@/lib/routes/track/plans/[id]/route";
import * as r63 from "@/lib/routes/track/plans/[id]/follow/route";
import * as r64 from "@/lib/routes/track/plans/[id]/issues/route";
import * as r65 from "@/lib/routes/track/plans/[id]/milestones/route";
import * as r66 from "@/lib/routes/track/plans/[id]/updates/route";
import * as r67 from "@/app/api/track/projects/route";
import * as r68 from "@/lib/routes/track/projects/[id]/route";
import * as r69 from "@/lib/routes/track/projects/[id]/ai/issue-from-text/route";
import * as r70 from "@/lib/routes/track/projects/[id]/ai/summary/route";
import * as r71 from "@/lib/routes/track/projects/[id]/automation/route";
import * as r72 from "@/lib/routes/track/projects/[id]/cycles/route";
import * as r73 from "@/lib/routes/track/projects/[id]/issues/route";
import * as r74 from "@/lib/routes/track/projects/[id]/members/route";
import * as r75 from "@/lib/routes/track/projects/[id]/milestones/route";
import * as r76 from "@/lib/routes/track/projects/[id]/recurring/route";
import * as r77 from "@/lib/routes/track/projects/[id]/statuses/route";
import * as r78 from "@/lib/routes/track/projects/[id]/statuses/reorder/route";
import * as r79 from "@/lib/routes/track/projects/[id]/templates/route";
import * as r80 from "@/lib/routes/track/projects/[id]/triage/route";
import * as r81 from "@/lib/routes/track/projects/[id]/triage-rules/route";
import * as r82 from "@/lib/routes/track/projects/[id]/triage-settings/route";
import * as r83 from "@/lib/routes/track/projects/[id]/views/route";
import * as r84 from "@/lib/routes/track/recurring/[id]/route";
import * as r85 from "@/app/api/track/refs/route";
import * as r86 from "@/lib/routes/track/statuses/[id]/route";
import * as r87 from "@/lib/routes/track/templates/[id]/route";
import * as r88 from "@/lib/routes/track/triage-rules/[id]/route";
import * as r89 from "@/lib/routes/track/views/[id]/route";
import * as r90 from "@/lib/routes/track/views/[id]/default/route";
import * as r91 from "@/lib/routes/track/views/[id]/favorite/route";
import * as r92 from "@/app/api/track/views/favorites/route";

export const routes: Record<string, unknown> = {
  "/api/track/access": r0,
  "/api/track/agent-sessions/[id]": r1,
  "/api/track/archive": r2,
  "/api/track/audit": r3,
  "/api/track/customer-requests/[id]": r4,
  "/api/track/customers": r5,
  "/api/track/customers/search": r6,
  "/api/track/cycles": r7,
  "/api/track/cycles/[id]": r8,
  "/api/track/cycles/[id]/complete": r9,
  "/api/track/cycles/[id]/metrics": r10,
  "/api/track/dashboard-widgets/[id]": r11,
  "/api/track/dashboards": r12,
  "/api/track/dashboards/[id]": r13,
  "/api/track/dashboards/[id]/widgets": r14,
  "/api/track/export": r15,
  "/api/track/github/rules": r16,
  "/api/track/initiatives": r17,
  "/api/track/initiatives/[id]": r18,
  "/api/track/insights": r19,
  "/api/track/integrations": r20,
  "/api/track/integrations/slack/channels": r21,
  "/api/track/issues": r22,
  "/api/track/issues/[id]": r23,
  "/api/track/issues/[id]/activities": r24,
  "/api/track/issues/[id]/agent": r25,
  "/api/track/issues/[id]/ai/suggestions": r26,
  "/api/track/issues/[id]/ai/suggestions/[sid]": r27,
  "/api/track/issues/[id]/ai/summary": r28,
  "/api/track/issues/[id]/attachments": r29,
  "/api/track/issues/[id]/attachments/[fileId]": r30,
  "/api/track/issues/[id]/attachments/finalize": r31,
  "/api/track/issues/[id]/attachments/upload": r32,
  "/api/track/issues/[id]/children": r33,
  "/api/track/issues/[id]/comments": r34,
  "/api/track/issues/[id]/comments/[commentId]": r35,
  "/api/track/issues/[id]/comments/[commentId]/reactions": r36,
  "/api/track/issues/[id]/comments/[commentId]/resolve": r37,
  "/api/track/issues/[id]/customer-requests": r38,
  "/api/track/issues/[id]/duplicates": r39,
  "/api/track/issues/[id]/favorite": r40,
  "/api/track/issues/[id]/github": r41,
  "/api/track/issues/[id]/insights": r42,
  "/api/track/issues/[id]/links": r43,
  "/api/track/issues/[id]/move": r44,
  "/api/track/issues/[id]/relations": r45,
  "/api/track/issues/[id]/reminder": r46,
  "/api/track/issues/[id]/snooze": r47,
  "/api/track/issues/[id]/subscription": r48,
  "/api/track/issues/[id]/triage": r49,
  "/api/track/issues/bulk": r50,
  "/api/track/issues/favorites": r51,
  "/api/track/labels": r52,
  "/api/track/labels/[id]": r53,
  "/api/track/list-views": r54,
  "/api/track/live": r55,
  "/api/track/milestones/[id]": r56,
  "/api/track/notify-prefs": r57,
  "/api/track/plan-milestones/[id]": r58,
  "/api/track/plan-updates/[id]": r59,
  "/api/track/plan-updates/[id]/comments": r60,
  "/api/track/plans": r61,
  "/api/track/plans/[id]": r62,
  "/api/track/plans/[id]/follow": r63,
  "/api/track/plans/[id]/issues": r64,
  "/api/track/plans/[id]/milestones": r65,
  "/api/track/plans/[id]/updates": r66,
  "/api/track/projects": r67,
  "/api/track/projects/[id]": r68,
  "/api/track/projects/[id]/ai/issue-from-text": r69,
  "/api/track/projects/[id]/ai/summary": r70,
  "/api/track/projects/[id]/automation": r71,
  "/api/track/projects/[id]/cycles": r72,
  "/api/track/projects/[id]/issues": r73,
  "/api/track/projects/[id]/members": r74,
  "/api/track/projects/[id]/milestones": r75,
  "/api/track/projects/[id]/recurring": r76,
  "/api/track/projects/[id]/statuses": r77,
  "/api/track/projects/[id]/statuses/reorder": r78,
  "/api/track/projects/[id]/templates": r79,
  "/api/track/projects/[id]/triage": r80,
  "/api/track/projects/[id]/triage-rules": r81,
  "/api/track/projects/[id]/triage-settings": r82,
  "/api/track/projects/[id]/views": r83,
  "/api/track/recurring/[id]": r84,
  "/api/track/refs": r85,
  "/api/track/statuses/[id]": r86,
  "/api/track/templates/[id]": r87,
  "/api/track/triage-rules/[id]": r88,
  "/api/track/views/[id]": r89,
  "/api/track/views/[id]/default": r90,
  "/api/track/views/[id]/favorite": r91,
  "/api/track/views/favorites": r92,
};
