// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/analytics/actions/route";
import * as r1 from "@/lib/routes/analytics/actions/[id]/route";
import * as r2 from "@/app/api/analytics/alerts/route";
import * as r3 from "@/lib/routes/analytics/alerts/[id]/route";
import * as r4 from "@/app/api/analytics/annotations/route";
import * as r5 from "@/lib/routes/analytics/annotations/[id]/route";
import * as r6 from "@/app/api/analytics/cohorts/route";
import * as r7 from "@/lib/routes/analytics/cohorts/[id]/route";
import * as r8 from "@/lib/routes/analytics/cohorts/[id]/members/route";
import * as r9 from "@/app/api/analytics/correlation/route";
import * as r10 from "@/app/api/analytics/dashboards/route";
import * as r11 from "@/lib/routes/analytics/dashboards/[id]/route";
import * as r12 from "@/app/api/analytics/definitions/route";
import * as r13 from "@/app/api/analytics/errors/route";
import * as r14 from "@/lib/routes/analytics/errors/[ref]/route";
import * as r15 from "@/app/api/analytics/events/route";
import * as r16 from "@/app/api/analytics/experiments/route";
import * as r17 from "@/lib/routes/analytics/experiments/[id]/route";
import * as r18 from "@/app/api/analytics/export/route";
import * as r19 from "@/app/api/analytics/flags/route";
import * as r20 from "@/lib/routes/analytics/flags/[id]/route";
import * as r21 from "@/app/api/analytics/heatmaps/route";
import * as r22 from "@/app/api/analytics/heatmaps/frame/route";
import * as r23 from "@/app/api/analytics/insights/route";
import * as r24 from "@/lib/routes/analytics/insights/[id]/route";
import * as r25 from "@/app/api/analytics/llm/route";
import * as r26 from "@/app/api/analytics/llm/generations/route";
import * as r27 from "@/app/api/analytics/persons/route";
import * as r28 from "@/lib/routes/analytics/persons/[id]/route";
import * as r29 from "@/app/api/analytics/projects/route";
import * as r30 from "@/lib/routes/analytics/projects/[id]/route";
import * as r31 from "@/app/api/analytics/properties/route";
import * as r32 from "@/app/api/analytics/query/route";
import * as r33 from "@/app/api/analytics/replay/route";
import * as r34 from "@/lib/routes/analytics/replay/[id]/route";
import * as r35 from "@/app/api/analytics/replay/sessions/route";
import * as r36 from "@/app/api/analytics/shares/route";
import * as r37 from "@/lib/routes/analytics/shares/[id]/route";
import * as r38 from "@/app/api/analytics/subscriptions/route";
import * as r39 from "@/lib/routes/analytics/subscriptions/[id]/route";
import * as r40 from "@/app/api/analytics/surveys/route";
import * as r41 from "@/lib/routes/analytics/surveys/[id]/route";
import * as r42 from "@/lib/routes/analytics/surveys/[id]/export/route";
import * as r43 from "@/lib/routes/analytics/surveys/[id]/results/route";
import * as r44 from "@/app/api/analytics/web-live/route";
import * as r45 from "@/app/api/analytics/web-vitals/route";

export const routes: Record<string, unknown> = {
  "/api/analytics/actions": r0,
  "/api/analytics/actions/[id]": r1,
  "/api/analytics/alerts": r2,
  "/api/analytics/alerts/[id]": r3,
  "/api/analytics/annotations": r4,
  "/api/analytics/annotations/[id]": r5,
  "/api/analytics/cohorts": r6,
  "/api/analytics/cohorts/[id]": r7,
  "/api/analytics/cohorts/[id]/members": r8,
  "/api/analytics/correlation": r9,
  "/api/analytics/dashboards": r10,
  "/api/analytics/dashboards/[id]": r11,
  "/api/analytics/definitions": r12,
  "/api/analytics/errors": r13,
  "/api/analytics/errors/[ref]": r14,
  "/api/analytics/events": r15,
  "/api/analytics/experiments": r16,
  "/api/analytics/experiments/[id]": r17,
  "/api/analytics/export": r18,
  "/api/analytics/flags": r19,
  "/api/analytics/flags/[id]": r20,
  "/api/analytics/heatmaps": r21,
  "/api/analytics/heatmaps/frame": r22,
  "/api/analytics/insights": r23,
  "/api/analytics/insights/[id]": r24,
  "/api/analytics/llm": r25,
  "/api/analytics/llm/generations": r26,
  "/api/analytics/persons": r27,
  "/api/analytics/persons/[id]": r28,
  "/api/analytics/projects": r29,
  "/api/analytics/projects/[id]": r30,
  "/api/analytics/properties": r31,
  "/api/analytics/query": r32,
  "/api/analytics/replay": r33,
  "/api/analytics/replay/[id]": r34,
  "/api/analytics/replay/sessions": r35,
  "/api/analytics/shares": r36,
  "/api/analytics/shares/[id]": r37,
  "/api/analytics/subscriptions": r38,
  "/api/analytics/subscriptions/[id]": r39,
  "/api/analytics/surveys": r40,
  "/api/analytics/surveys/[id]": r41,
  "/api/analytics/surveys/[id]/export": r42,
  "/api/analytics/surveys/[id]/results": r43,
  "/api/analytics/web-live": r44,
  "/api/analytics/web-vitals": r45,
};
