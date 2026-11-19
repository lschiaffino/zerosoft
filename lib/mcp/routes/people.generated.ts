// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/people/audit/route";
import * as r1 from "@/app/api/people/calendar/route";
import * as r2 from "@/app/api/people/changes/route";
import * as r3 from "@/lib/routes/people/changes/[id]/route";
import * as r4 from "@/app/api/people/checklists/route";
import * as r5 from "@/lib/routes/people/checklists/[id]/route";
import * as r6 from "@/app/api/people/custom-reports/route";
import * as r7 from "@/lib/routes/people/custom-reports/[id]/route";
import * as r8 from "@/app/api/people/cycles/route";
import * as r9 from "@/lib/routes/people/cycles/[id]/route";
import * as r10 from "@/lib/routes/people/cycles/[id]/launch/route";
import * as r11 from "@/lib/routes/people/cycles/[id]/peers/route";
import * as r12 from "@/app/api/people/documents/route";
import * as r13 from "@/lib/routes/people/documents/[id]/route";
import * as r14 from "@/lib/routes/people/documents/[id]/ack/route";
import * as r15 from "@/app/api/people/employees/route";
import * as r16 from "@/lib/routes/people/employees/[id]/route";
import * as r17 from "@/lib/routes/people/employees/[id]/balances/route";
import * as r18 from "@/lib/routes/people/employees/[id]/compensation/route";
import * as r19 from "@/lib/routes/people/employees/[id]/exit/route";
import * as r20 from "@/lib/routes/people/employees/[id]/exit-interview/route";
import * as r21 from "@/lib/routes/people/employees/[id]/goals/route";
import * as r22 from "@/lib/routes/people/employees/[id]/history/route";
import * as r23 from "@/lib/routes/people/employees/[id]/notes/route";
import * as r24 from "@/lib/routes/people/employees/[id]/offboard/route";
import * as r25 from "@/lib/routes/people/employees/[id]/one-on-ones/route";
import * as r26 from "@/lib/routes/people/employees/[id]/photo/route";
import * as r27 from "@/lib/routes/people/employees/[id]/scheduled/route";
import * as r28 from "@/app/api/people/export/route";
import * as r29 from "@/app/api/people/fields/route";
import * as r30 from "@/lib/routes/people/fields/[id]/route";
import * as r31 from "@/lib/routes/people/goals/[id]/route";
import * as r32 from "@/app/api/people/handbook/route";
import * as r33 from "@/app/api/people/holidays/route";
import * as r34 from "@/lib/routes/people/holidays/[id]/route";
import * as r35 from "@/app/api/people/import/route";
import * as r36 from "@/app/api/people/me/route";
import * as r37 from "@/lib/routes/people/notes/[id]/route";
import * as r38 from "@/lib/routes/people/one-on-ones/[id]/route";
import * as r39 from "@/app/api/people/org/route";
import * as r40 from "@/app/api/people/policies/route";
import * as r41 from "@/lib/routes/people/policies/[id]/route";
import * as r42 from "@/app/api/people/reports/route";
import * as r43 from "@/app/api/people/reviews/route";
import * as r44 from "@/lib/routes/people/reviews/[id]/route";
import * as r45 from "@/lib/routes/people/scheduled/[id]/route";
import * as r46 from "@/app/api/people/settings/route";
import * as r47 from "@/app/api/people/surveys/route";
import * as r48 from "@/lib/routes/people/surveys/[id]/route";
import * as r49 from "@/lib/routes/people/tasks/[id]/route";
import * as r50 from "@/app/api/people/templates/route";
import * as r51 from "@/lib/routes/people/templates/[id]/route";
import * as r52 from "@/app/api/people/time-off/route";
import * as r53 from "@/lib/routes/people/time-off/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/people/audit": r0,
  "/api/people/calendar": r1,
  "/api/people/changes": r2,
  "/api/people/changes/[id]": r3,
  "/api/people/checklists": r4,
  "/api/people/checklists/[id]": r5,
  "/api/people/custom-reports": r6,
  "/api/people/custom-reports/[id]": r7,
  "/api/people/cycles": r8,
  "/api/people/cycles/[id]": r9,
  "/api/people/cycles/[id]/launch": r10,
  "/api/people/cycles/[id]/peers": r11,
  "/api/people/documents": r12,
  "/api/people/documents/[id]": r13,
  "/api/people/documents/[id]/ack": r14,
  "/api/people/employees": r15,
  "/api/people/employees/[id]": r16,
  "/api/people/employees/[id]/balances": r17,
  "/api/people/employees/[id]/compensation": r18,
  "/api/people/employees/[id]/exit": r19,
  "/api/people/employees/[id]/exit-interview": r20,
  "/api/people/employees/[id]/goals": r21,
  "/api/people/employees/[id]/history": r22,
  "/api/people/employees/[id]/notes": r23,
  "/api/people/employees/[id]/offboard": r24,
  "/api/people/employees/[id]/one-on-ones": r25,
  "/api/people/employees/[id]/photo": r26,
  "/api/people/employees/[id]/scheduled": r27,
  "/api/people/export": r28,
  "/api/people/fields": r29,
  "/api/people/fields/[id]": r30,
  "/api/people/goals/[id]": r31,
  "/api/people/handbook": r32,
  "/api/people/holidays": r33,
  "/api/people/holidays/[id]": r34,
  "/api/people/import": r35,
  "/api/people/me": r36,
  "/api/people/notes/[id]": r37,
  "/api/people/one-on-ones/[id]": r38,
  "/api/people/org": r39,
  "/api/people/policies": r40,
  "/api/people/policies/[id]": r41,
  "/api/people/reports": r42,
  "/api/people/reviews": r43,
  "/api/people/reviews/[id]": r44,
  "/api/people/scheduled/[id]": r45,
  "/api/people/settings": r46,
  "/api/people/surveys": r47,
  "/api/people/surveys/[id]": r48,
  "/api/people/tasks/[id]": r49,
  "/api/people/templates": r50,
  "/api/people/templates/[id]": r51,
  "/api/people/time-off": r52,
  "/api/people/time-off/[id]": r53,
};
