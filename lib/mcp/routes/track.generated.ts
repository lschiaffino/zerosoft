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
import * as r17 from "@/lib/routes/track/initiative-updates/[id]/route";
import * as r18 from "@/app/api/track/initiatives/route";
import * as r19 from "@/lib/routes/track/initiatives/[id]/route";
import * as r20 from "@/lib/routes/track/initiatives/[id]/comments/route";
import * as r21 from "@/lib/routes/track/initiatives/[id]/comments/[commentId]/route";
import * as r22 from "@/lib/routes/track/initiatives/[id]/comments/[commentId]/reactions/route";
import * as r23 from "@/lib/routes/track/initiatives/[id]/comments/[commentId]/resolve/route";
import * as r24 from "@/lib/routes/track/initiatives/[id]/updates/route";
import * as r25 from "@/app/api/track/insights/route";
import * as r26 from "@/app/api/track/integrations/route";
import * as r27 from "@/app/api/track/integrations/linear/route";
import * as r28 from "@/app/api/track/integrations/slack/channels/route";
import * as r29 from "@/app/api/track/issues/route";
import * as r30 from "@/lib/routes/track/issues/[id]/route";
import * as r31 from "@/lib/routes/track/issues/[id]/activities/route";
import * as r32 from "@/lib/routes/track/issues/[id]/agent/route";
import * as r33 from "@/lib/routes/track/issues/[id]/ai/suggestions/route";
import * as r34 from "@/lib/routes/track/issues/[id]/ai/suggestions/[sid]/route";
import * as r35 from "@/lib/routes/track/issues/[id]/ai/summary/route";
import * as r36 from "@/lib/routes/track/issues/[id]/attachments/route";
import * as r37 from "@/lib/routes/track/issues/[id]/children/route";
import * as r38 from "@/lib/routes/track/issues/[id]/comments/route";
import * as r39 from "@/lib/routes/track/issues/[id]/comments/[commentId]/route";
import * as r40 from "@/lib/routes/track/issues/[id]/comments/[commentId]/reactions/route";
import * as r41 from "@/lib/routes/track/issues/[id]/comments/[commentId]/resolve/route";
import * as r42 from "@/lib/routes/track/issues/[id]/customer-requests/route";
import * as r43 from "@/lib/routes/track/issues/[id]/duplicate-of/route";
import * as r44 from "@/lib/routes/track/issues/[id]/duplicates/route";
import * as r45 from "@/lib/routes/track/issues/[id]/favorite/route";
import * as r46 from "@/lib/routes/track/issues/[id]/github/route";
import * as r47 from "@/lib/routes/track/issues/[id]/insights/route";
import * as r48 from "@/lib/routes/track/issues/[id]/links/route";
import * as r49 from "@/lib/routes/track/issues/[id]/move/route";
import * as r50 from "@/lib/routes/track/issues/[id]/relations/route";
import * as r51 from "@/lib/routes/track/issues/[id]/reminder/route";
import * as r52 from "@/lib/routes/track/issues/[id]/snooze/route";
import * as r53 from "@/lib/routes/track/issues/[id]/subscription/route";
import * as r54 from "@/lib/routes/track/issues/[id]/triage/route";
import * as r55 from "@/app/api/track/issues/bulk/route";
import * as r56 from "@/app/api/track/issues/favorites/route";
import * as r57 from "@/app/api/track/labels/route";
import * as r58 from "@/lib/routes/track/labels/[id]/route";
import * as r59 from "@/app/api/track/list-views/route";
import * as r60 from "@/app/api/track/live/route";
import * as r61 from "@/lib/routes/track/milestones/[id]/route";
import * as r62 from "@/app/api/track/notify-prefs/route";
import * as r63 from "@/lib/routes/track/plan-milestones/[id]/route";
import * as r64 from "@/app/api/track/plan-templates/route";
import * as r65 from "@/lib/routes/track/plan-templates/[id]/route";
import * as r66 from "@/lib/routes/track/plan-updates/[id]/route";
import * as r67 from "@/lib/routes/track/plan-updates/[id]/comments/route";
import * as r68 from "@/app/api/track/plans/route";
import * as r69 from "@/lib/routes/track/plans/[id]/route";
import * as r70 from "@/lib/routes/track/plans/[id]/comments/route";
import * as r71 from "@/lib/routes/track/plans/[id]/comments/[commentId]/route";
import * as r72 from "@/lib/routes/track/plans/[id]/comments/[commentId]/reactions/route";
import * as r73 from "@/lib/routes/track/plans/[id]/comments/[commentId]/resolve/route";
import * as r74 from "@/lib/routes/track/plans/[id]/follow/route";
import * as r75 from "@/lib/routes/track/plans/[id]/issues/route";
import * as r76 from "@/lib/routes/track/plans/[id]/milestones/route";
import * as r77 from "@/lib/routes/track/plans/[id]/updates/route";
import * as r78 from "@/app/api/track/projects/route";
import * as r79 from "@/lib/routes/track/projects/[id]/route";
import * as r80 from "@/lib/routes/track/projects/[id]/ai/issue-from-text/route";
import * as r81 from "@/lib/routes/track/projects/[id]/ai/summary/route";
import * as r82 from "@/lib/routes/track/projects/[id]/automation/route";
import * as r83 from "@/lib/routes/track/projects/[id]/cycles/route";
import * as r84 from "@/lib/routes/track/projects/[id]/issues/route";
import * as r85 from "@/lib/routes/track/projects/[id]/members/route";
import * as r86 from "@/lib/routes/track/projects/[id]/milestones/route";
import * as r87 from "@/lib/routes/track/projects/[id]/recurring/route";
import * as r88 from "@/lib/routes/track/projects/[id]/statuses/route";
import * as r89 from "@/lib/routes/track/projects/[id]/statuses/reorder/route";
import * as r90 from "@/lib/routes/track/projects/[id]/templates/route";
import * as r91 from "@/lib/routes/track/projects/[id]/triage/route";
import * as r92 from "@/lib/routes/track/projects/[id]/triage-rules/route";
import * as r93 from "@/lib/routes/track/projects/[id]/triage-settings/route";
import * as r94 from "@/lib/routes/track/projects/[id]/views/route";
import * as r95 from "@/lib/routes/track/recurring/[id]/route";
import * as r96 from "@/app/api/track/refs/route";
import * as r97 from "@/lib/routes/track/statuses/[id]/route";
import * as r98 from "@/lib/routes/track/templates/[id]/route";
import * as r99 from "@/lib/routes/track/triage-rules/[id]/route";
import * as r100 from "@/lib/routes/track/views/[id]/route";
import * as r101 from "@/lib/routes/track/views/[id]/default/route";
import * as r102 from "@/lib/routes/track/views/[id]/favorite/route";
import * as r103 from "@/app/api/track/views/favorites/route";

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
  "/api/track/initiative-updates/[id]": r17,
  "/api/track/initiatives": r18,
  "/api/track/initiatives/[id]": r19,
  "/api/track/initiatives/[id]/comments": r20,
  "/api/track/initiatives/[id]/comments/[commentId]": r21,
  "/api/track/initiatives/[id]/comments/[commentId]/reactions": r22,
  "/api/track/initiatives/[id]/comments/[commentId]/resolve": r23,
  "/api/track/initiatives/[id]/updates": r24,
  "/api/track/insights": r25,
  "/api/track/integrations": r26,
  "/api/track/integrations/linear": r27,
  "/api/track/integrations/slack/channels": r28,
  "/api/track/issues": r29,
  "/api/track/issues/[id]": r30,
  "/api/track/issues/[id]/activities": r31,
  "/api/track/issues/[id]/agent": r32,
  "/api/track/issues/[id]/ai/suggestions": r33,
  "/api/track/issues/[id]/ai/suggestions/[sid]": r34,
  "/api/track/issues/[id]/ai/summary": r35,
  "/api/track/issues/[id]/attachments": r36,
  "/api/track/issues/[id]/children": r37,
  "/api/track/issues/[id]/comments": r38,
  "/api/track/issues/[id]/comments/[commentId]": r39,
  "/api/track/issues/[id]/comments/[commentId]/reactions": r40,
  "/api/track/issues/[id]/comments/[commentId]/resolve": r41,
  "/api/track/issues/[id]/customer-requests": r42,
  "/api/track/issues/[id]/duplicate-of": r43,
  "/api/track/issues/[id]/duplicates": r44,
  "/api/track/issues/[id]/favorite": r45,
  "/api/track/issues/[id]/github": r46,
  "/api/track/issues/[id]/insights": r47,
  "/api/track/issues/[id]/links": r48,
  "/api/track/issues/[id]/move": r49,
  "/api/track/issues/[id]/relations": r50,
  "/api/track/issues/[id]/reminder": r51,
  "/api/track/issues/[id]/snooze": r52,
  "/api/track/issues/[id]/subscription": r53,
  "/api/track/issues/[id]/triage": r54,
  "/api/track/issues/bulk": r55,
  "/api/track/issues/favorites": r56,
  "/api/track/labels": r57,
  "/api/track/labels/[id]": r58,
  "/api/track/list-views": r59,
  "/api/track/live": r60,
  "/api/track/milestones/[id]": r61,
  "/api/track/notify-prefs": r62,
  "/api/track/plan-milestones/[id]": r63,
  "/api/track/plan-templates": r64,
  "/api/track/plan-templates/[id]": r65,
  "/api/track/plan-updates/[id]": r66,
  "/api/track/plan-updates/[id]/comments": r67,
  "/api/track/plans": r68,
  "/api/track/plans/[id]": r69,
  "/api/track/plans/[id]/comments": r70,
  "/api/track/plans/[id]/comments/[commentId]": r71,
  "/api/track/plans/[id]/comments/[commentId]/reactions": r72,
  "/api/track/plans/[id]/comments/[commentId]/resolve": r73,
  "/api/track/plans/[id]/follow": r74,
  "/api/track/plans/[id]/issues": r75,
  "/api/track/plans/[id]/milestones": r76,
  "/api/track/plans/[id]/updates": r77,
  "/api/track/projects": r78,
  "/api/track/projects/[id]": r79,
  "/api/track/projects/[id]/ai/issue-from-text": r80,
  "/api/track/projects/[id]/ai/summary": r81,
  "/api/track/projects/[id]/automation": r82,
  "/api/track/projects/[id]/cycles": r83,
  "/api/track/projects/[id]/issues": r84,
  "/api/track/projects/[id]/members": r85,
  "/api/track/projects/[id]/milestones": r86,
  "/api/track/projects/[id]/recurring": r87,
  "/api/track/projects/[id]/statuses": r88,
  "/api/track/projects/[id]/statuses/reorder": r89,
  "/api/track/projects/[id]/templates": r90,
  "/api/track/projects/[id]/triage": r91,
  "/api/track/projects/[id]/triage-rules": r92,
  "/api/track/projects/[id]/triage-settings": r93,
  "/api/track/projects/[id]/views": r94,
  "/api/track/recurring/[id]": r95,
  "/api/track/refs": r96,
  "/api/track/statuses/[id]": r97,
  "/api/track/templates/[id]": r98,
  "/api/track/triage-rules/[id]": r99,
  "/api/track/views/[id]": r100,
  "/api/track/views/[id]/default": r101,
  "/api/track/views/[id]/favorite": r102,
  "/api/track/views/favorites": r103,
};
