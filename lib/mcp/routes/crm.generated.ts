// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/crm/activities/route";
import * as r1 from "@/lib/routes/crm/activities/[id]/route";
import * as r2 from "@/lib/routes/crm/activities/[id]/comments/route";
import * as r3 from "@/lib/routes/crm/activities/[id]/comments/[commentId]/route";
import * as r4 from "@/lib/routes/crm/activities/[id]/files/route";
import * as r5 from "@/lib/routes/crm/activities/[id]/zoom/route";
import * as r6 from "@/app/api/crm/ai/assistant/route";
import * as r7 from "@/app/api/crm/ai/call-summary/route";
import * as r8 from "@/app/api/crm/ai/deal-score/route";
import * as r9 from "@/app/api/crm/ai/deal-score/batch/route";
import * as r10 from "@/app/api/crm/ai/runs/route";
import * as r11 from "@/lib/routes/crm/ai/runs/[id]/route";
import * as r12 from "@/app/api/crm/ai/runs/[id]/apply-all/route";
import * as r13 from "@/lib/routes/crm/ai/runs/[id]/items/[itemId]/route";
import * as r14 from "@/lib/routes/crm/ai/runs/[id]/items/[itemId]/apply/route";
import * as r15 from "@/lib/routes/crm/ai/runs/[id]/items/[itemId]/send/route";
import * as r16 from "@/app/api/crm/ai/runs/[id]/step/route";
import * as r17 from "@/app/api/crm/ai/summary/route";
import * as r18 from "@/app/api/crm/approval-rules/route";
import * as r19 from "@/lib/routes/crm/approval-rules/[id]/route";
import * as r20 from "@/lib/routes/crm/approvals/[id]/route";
import * as r21 from "@/app/api/crm/apps/route";
import * as r22 from "@/app/api/crm/assignment/route";
import * as r23 from "@/app/api/crm/assignment/availability/route";
import * as r24 from "@/app/api/crm/association-labels/route";
import * as r25 from "@/app/api/crm/associations/route";
import * as r26 from "@/app/api/crm/associations/search/route";
import * as r27 from "@/app/api/crm/companies/route";
import * as r28 from "@/lib/routes/crm/companies/[id]/route";
import * as r29 from "@/lib/routes/crm/companies/[id]/enrich/route";
import * as r30 from "@/lib/routes/crm/companies/[id]/files/route";
import * as r31 from "@/app/api/crm/companies/bulk/route";
import * as r32 from "@/app/api/crm/companies/duplicates/route";
import * as r33 from "@/app/api/crm/companies/enrich/route";
import * as r34 from "@/app/api/crm/companies/merge/route";
import * as r35 from "@/app/api/crm/contacts/route";
import * as r36 from "@/lib/routes/crm/contacts/[id]/route";
import * as r37 from "@/lib/routes/crm/contacts/[id]/files/route";
import * as r38 from "@/app/api/crm/contacts/bulk/route";
import * as r39 from "@/app/api/crm/contacts/duplicates/route";
import * as r40 from "@/app/api/crm/contacts/merge/route";
import * as r41 from "@/app/api/crm/create-form/route";
import * as r42 from "@/app/api/crm/custom-fields/route";
import * as r43 from "@/lib/routes/crm/custom-fields/[id]/route";
import * as r44 from "@/app/api/crm/custom-reports/route";
import * as r45 from "@/lib/routes/crm/custom-reports/[id]/route";
import * as r46 from "@/app/api/crm/custom-reports/run/route";
import * as r47 from "@/app/api/crm/dashboards/route";
import * as r48 from "@/lib/routes/crm/dashboards/[id]/route";
import * as r49 from "@/lib/routes/crm/dashboards/[id]/widgets/route";
import * as r50 from "@/app/api/crm/dashboards/data/route";
import * as r51 from "@/app/api/crm/dashboards/drill/route";
import * as r52 from "@/lib/routes/crm/dashboards/widgets/[widgetId]/route";
import * as r53 from "@/app/api/crm/deals/route";
import * as r54 from "@/lib/routes/crm/deals/[id]/route";
import * as r55 from "@/lib/routes/crm/deals/[id]/approvals/route";
import * as r56 from "@/lib/routes/crm/deals/[id]/files/route";
import * as r57 from "@/lib/routes/crm/deals/[id]/line-items/route";
import * as r58 from "@/lib/routes/crm/deals/[id]/line-items/[itemId]/route";
import * as r59 from "@/lib/routes/crm/deals/[id]/move/route";
import * as r60 from "@/lib/routes/crm/deals/[id]/splits/route";
import * as r61 from "@/app/api/crm/deals/bulk/route";
import * as r62 from "@/app/api/crm/documents/route";
import * as r63 from "@/lib/routes/crm/documents/[id]/route";
import * as r64 from "@/lib/routes/crm/documents/[id]/file/route";
import * as r65 from "@/lib/routes/crm/documents/[id]/links/route";
import * as r66 from "@/app/api/crm/email-settings/route";
import * as r67 from "@/app/api/crm/email-templates/route";
import * as r68 from "@/lib/routes/crm/email-templates/[id]/route";
import * as r69 from "@/app/api/crm/email-templates/preview/route";
import * as r70 from "@/app/api/crm/emails/route";
import * as r71 from "@/app/api/crm/emails/draft/route";
import * as r72 from "@/app/api/crm/exchange-rates/route";
import * as r73 from "@/app/api/crm/export/route";
import * as r74 from "@/app/api/crm/extension/download/route";
import * as r75 from "@/app/api/crm/field-permissions/route";
import * as r76 from "@/lib/routes/crm/field-permissions/[fieldId]/route";
import * as r77 from "@/app/api/crm/forecast/route";
import * as r78 from "@/lib/routes/crm/forecast/deals/[id]/route";
import * as r79 from "@/app/api/crm/forecast/submissions/route";
import * as r80 from "@/app/api/crm/forms/route";
import * as r81 from "@/lib/routes/crm/forms/[id]/route";
import * as r82 from "@/lib/routes/crm/forms/[id]/submissions/route";
import * as r83 from "@/app/api/crm/history/route";
import * as r84 from "@/app/api/crm/hubspot-sync/route";
import * as r85 from "@/app/api/crm/hubspot-sync/conflicts/route";
import * as r86 from "@/app/api/crm/hubspot-sync/inbound/route";
import * as r87 from "@/app/api/crm/hubspot-sync/inbound/run/route";
import * as r88 from "@/app/api/crm/hubspot-sync/outbound/route";
import * as r89 from "@/app/api/crm/hubspot-sync/preview/route";
import * as r90 from "@/app/api/crm/hubspot-sync/preview/run/route";
import * as r91 from "@/app/api/crm/import/route";
import * as r92 from "@/app/api/crm/import/jobs/route";
import * as r93 from "@/lib/routes/crm/import/jobs/[id]/route";
import * as r94 from "@/app/api/crm/import/jobs/[id]/run/route";
import * as r95 from "@/app/api/crm/import/presets/route";
import * as r96 from "@/lib/routes/crm/import/presets/[id]/route";
import * as r97 from "@/app/api/crm/layouts/route";
import * as r98 from "@/app/api/crm/lead-stages/route";
import * as r99 from "@/lib/routes/crm/lead-stages/[id]/route";
import * as r100 from "@/app/api/crm/leads/route";
import * as r101 from "@/lib/routes/crm/leads/[id]/route";
import * as r102 from "@/lib/routes/crm/leads/[id]/convert/route";
import * as r103 from "@/app/api/crm/lists/route";
import * as r104 from "@/lib/routes/crm/lists/[id]/route";
import * as r105 from "@/lib/routes/crm/lists/[id]/members/route";
import * as r106 from "@/app/api/crm/live/route";
import * as r107 from "@/lib/routes/crm/logo/[domain]/route";
import * as r108 from "@/app/api/crm/meeting-links/route";
import * as r109 from "@/app/api/crm/mentionables/route";
import * as r110 from "@/app/api/crm/objects/route";
import * as r111 from "@/lib/routes/crm/objects/[id]/route";
import * as r112 from "@/lib/routes/crm/objects/[id]/import/route";
import * as r113 from "@/lib/routes/crm/objects/[id]/records/route";
import * as r114 from "@/app/api/crm/pipelines/route";
import * as r115 from "@/lib/routes/crm/pipelines/[id]/route";
import * as r116 from "@/lib/routes/crm/pipelines/[id]/stages/route";
import * as r117 from "@/lib/routes/crm/pipelines/[id]/stages/reorder/route";
import * as r118 from "@/app/api/crm/playbooks/route";
import * as r119 from "@/lib/routes/crm/playbooks/[id]/route";
import * as r120 from "@/lib/routes/crm/playbooks/[id]/runs/route";
import * as r121 from "@/app/api/crm/products/route";
import * as r122 from "@/lib/routes/crm/products/[id]/route";
import * as r123 from "@/app/api/crm/quotas/route";
import * as r124 from "@/lib/routes/crm/quotas/[id]/route";
import * as r125 from "@/app/api/crm/quotes/route";
import * as r126 from "@/lib/routes/crm/quotes/[id]/route";
import * as r127 from "@/lib/routes/crm/quotes/[id]/certificate/route";
import * as r128 from "@/lib/routes/crm/records/[id]/route";
import * as r129 from "@/lib/routes/crm/records/[id]/links/route";
import * as r130 from "@/app/api/crm/reports/route";
import * as r131 from "@/app/api/crm/sales-teams/route";
import * as r132 from "@/lib/routes/crm/sales-teams/[id]/route";
import * as r133 from "@/app/api/crm/scoring/recalculate/route";
import * as r134 from "@/app/api/crm/scoring/rules/route";
import * as r135 from "@/lib/routes/crm/scoring/rules/[id]/route";
import * as r136 from "@/app/api/crm/scoring/scores/route";
import * as r137 from "@/lib/routes/crm/scoring/scores/[id]/route";
import * as r138 from "@/app/api/crm/search/route";
import * as r139 from "@/app/api/crm/sequences/route";
import * as r140 from "@/lib/routes/crm/sequences/[id]/route";
import * as r141 from "@/lib/routes/crm/sequences/[id]/enroll/route";
import * as r142 from "@/lib/routes/crm/sequences/enrollments/[id]/route";
import * as r143 from "@/app/api/crm/settings/route";
import * as r144 from "@/lib/routes/crm/stages/[id]/route";
import * as r145 from "@/app/api/crm/tags/route";
import * as r146 from "@/lib/routes/crm/tags/[id]/route";
import * as r147 from "@/app/api/crm/tags/apply/route";
import * as r148 from "@/app/api/crm/tags/record/route";
import * as r149 from "@/lib/routes/crm/tasks/[id]/files/route";
import * as r150 from "@/lib/routes/crm/tasks/[id]/snooze/route";
import * as r151 from "@/lib/routes/crm/tasks/[id]/track/route";
import * as r152 from "@/app/api/crm/tasks/bulk/route";
import * as r153 from "@/app/api/crm/tasks/digest/route";
import * as r154 from "@/app/api/crm/tasks/due-count/route";
import * as r155 from "@/app/api/crm/tasks/projects/route";
import * as r156 from "@/lib/routes/crm/tasks/projects/[id]/route";
import * as r157 from "@/app/api/crm/tasks/queues/route";
import * as r158 from "@/lib/routes/crm/tasks/queues/[id]/route";
import * as r159 from "@/app/api/crm/timeline/route";
import * as r160 from "@/app/api/crm/trash/route";
import * as r161 from "@/lib/routes/crm/trash/[id]/restore/route";
import * as r162 from "@/app/api/crm/videos/route";
import * as r163 from "@/lib/routes/crm/videos/[id]/route";
import * as r164 from "@/lib/routes/crm/videos/[id]/file/route";
import * as r165 from "@/app/api/crm/views/route";
import * as r166 from "@/lib/routes/crm/views/[id]/route";
import * as r167 from "@/app/api/crm/views/tabs/route";
import * as r168 from "@/app/api/crm/visibility/route";
import * as r169 from "@/app/api/crm/voice/calls/route";
import * as r170 from "@/lib/routes/crm/voice/calls/[id]/route";
import * as r171 from "@/lib/routes/crm/voice/calls/[id]/end/route";
import * as r172 from "@/lib/routes/crm/voice/calls/[id]/recording/route";
import * as r173 from "@/app/api/crm/voice/calls/[id]/summarize/route";
import * as r174 from "@/app/api/crm/voice/fake/route";
import * as r175 from "@/app/api/crm/voice/settings/route";
import * as r176 from "@/app/api/crm/workflows/route";
import * as r177 from "@/lib/routes/crm/workflows/[id]/route";
import * as r178 from "@/lib/routes/crm/workflows/[id]/enroll-existing/route";
import * as r179 from "@/lib/routes/crm/workflows/[id]/enrollments/[runId]/route";
import * as r180 from "@/lib/routes/crm/workflows/[id]/run/route";
import * as r181 from "@/lib/routes/crm/workflows/[id]/toggle/route";

export const routes: Record<string, unknown> = {
  "/api/crm/activities": r0,
  "/api/crm/activities/[id]": r1,
  "/api/crm/activities/[id]/comments": r2,
  "/api/crm/activities/[id]/comments/[commentId]": r3,
  "/api/crm/activities/[id]/files": r4,
  "/api/crm/activities/[id]/zoom": r5,
  "/api/crm/ai/assistant": r6,
  "/api/crm/ai/call-summary": r7,
  "/api/crm/ai/deal-score": r8,
  "/api/crm/ai/deal-score/batch": r9,
  "/api/crm/ai/runs": r10,
  "/api/crm/ai/runs/[id]": r11,
  "/api/crm/ai/runs/[id]/apply-all": r12,
  "/api/crm/ai/runs/[id]/items/[itemId]": r13,
  "/api/crm/ai/runs/[id]/items/[itemId]/apply": r14,
  "/api/crm/ai/runs/[id]/items/[itemId]/send": r15,
  "/api/crm/ai/runs/[id]/step": r16,
  "/api/crm/ai/summary": r17,
  "/api/crm/approval-rules": r18,
  "/api/crm/approval-rules/[id]": r19,
  "/api/crm/approvals/[id]": r20,
  "/api/crm/apps": r21,
  "/api/crm/assignment": r22,
  "/api/crm/assignment/availability": r23,
  "/api/crm/association-labels": r24,
  "/api/crm/associations": r25,
  "/api/crm/associations/search": r26,
  "/api/crm/companies": r27,
  "/api/crm/companies/[id]": r28,
  "/api/crm/companies/[id]/enrich": r29,
  "/api/crm/companies/[id]/files": r30,
  "/api/crm/companies/bulk": r31,
  "/api/crm/companies/duplicates": r32,
  "/api/crm/companies/enrich": r33,
  "/api/crm/companies/merge": r34,
  "/api/crm/contacts": r35,
  "/api/crm/contacts/[id]": r36,
  "/api/crm/contacts/[id]/files": r37,
  "/api/crm/contacts/bulk": r38,
  "/api/crm/contacts/duplicates": r39,
  "/api/crm/contacts/merge": r40,
  "/api/crm/create-form": r41,
  "/api/crm/custom-fields": r42,
  "/api/crm/custom-fields/[id]": r43,
  "/api/crm/custom-reports": r44,
  "/api/crm/custom-reports/[id]": r45,
  "/api/crm/custom-reports/run": r46,
  "/api/crm/dashboards": r47,
  "/api/crm/dashboards/[id]": r48,
  "/api/crm/dashboards/[id]/widgets": r49,
  "/api/crm/dashboards/data": r50,
  "/api/crm/dashboards/drill": r51,
  "/api/crm/dashboards/widgets/[widgetId]": r52,
  "/api/crm/deals": r53,
  "/api/crm/deals/[id]": r54,
  "/api/crm/deals/[id]/approvals": r55,
  "/api/crm/deals/[id]/files": r56,
  "/api/crm/deals/[id]/line-items": r57,
  "/api/crm/deals/[id]/line-items/[itemId]": r58,
  "/api/crm/deals/[id]/move": r59,
  "/api/crm/deals/[id]/splits": r60,
  "/api/crm/deals/bulk": r61,
  "/api/crm/documents": r62,
  "/api/crm/documents/[id]": r63,
  "/api/crm/documents/[id]/file": r64,
  "/api/crm/documents/[id]/links": r65,
  "/api/crm/email-settings": r66,
  "/api/crm/email-templates": r67,
  "/api/crm/email-templates/[id]": r68,
  "/api/crm/email-templates/preview": r69,
  "/api/crm/emails": r70,
  "/api/crm/emails/draft": r71,
  "/api/crm/exchange-rates": r72,
  "/api/crm/export": r73,
  "/api/crm/extension/download": r74,
  "/api/crm/field-permissions": r75,
  "/api/crm/field-permissions/[fieldId]": r76,
  "/api/crm/forecast": r77,
  "/api/crm/forecast/deals/[id]": r78,
  "/api/crm/forecast/submissions": r79,
  "/api/crm/forms": r80,
  "/api/crm/forms/[id]": r81,
  "/api/crm/forms/[id]/submissions": r82,
  "/api/crm/history": r83,
  "/api/crm/hubspot-sync": r84,
  "/api/crm/hubspot-sync/conflicts": r85,
  "/api/crm/hubspot-sync/inbound": r86,
  "/api/crm/hubspot-sync/inbound/run": r87,
  "/api/crm/hubspot-sync/outbound": r88,
  "/api/crm/hubspot-sync/preview": r89,
  "/api/crm/hubspot-sync/preview/run": r90,
  "/api/crm/import": r91,
  "/api/crm/import/jobs": r92,
  "/api/crm/import/jobs/[id]": r93,
  "/api/crm/import/jobs/[id]/run": r94,
  "/api/crm/import/presets": r95,
  "/api/crm/import/presets/[id]": r96,
  "/api/crm/layouts": r97,
  "/api/crm/lead-stages": r98,
  "/api/crm/lead-stages/[id]": r99,
  "/api/crm/leads": r100,
  "/api/crm/leads/[id]": r101,
  "/api/crm/leads/[id]/convert": r102,
  "/api/crm/lists": r103,
  "/api/crm/lists/[id]": r104,
  "/api/crm/lists/[id]/members": r105,
  "/api/crm/live": r106,
  "/api/crm/logo/[domain]": r107,
  "/api/crm/meeting-links": r108,
  "/api/crm/mentionables": r109,
  "/api/crm/objects": r110,
  "/api/crm/objects/[id]": r111,
  "/api/crm/objects/[id]/import": r112,
  "/api/crm/objects/[id]/records": r113,
  "/api/crm/pipelines": r114,
  "/api/crm/pipelines/[id]": r115,
  "/api/crm/pipelines/[id]/stages": r116,
  "/api/crm/pipelines/[id]/stages/reorder": r117,
  "/api/crm/playbooks": r118,
  "/api/crm/playbooks/[id]": r119,
  "/api/crm/playbooks/[id]/runs": r120,
  "/api/crm/products": r121,
  "/api/crm/products/[id]": r122,
  "/api/crm/quotas": r123,
  "/api/crm/quotas/[id]": r124,
  "/api/crm/quotes": r125,
  "/api/crm/quotes/[id]": r126,
  "/api/crm/quotes/[id]/certificate": r127,
  "/api/crm/records/[id]": r128,
  "/api/crm/records/[id]/links": r129,
  "/api/crm/reports": r130,
  "/api/crm/sales-teams": r131,
  "/api/crm/sales-teams/[id]": r132,
  "/api/crm/scoring/recalculate": r133,
  "/api/crm/scoring/rules": r134,
  "/api/crm/scoring/rules/[id]": r135,
  "/api/crm/scoring/scores": r136,
  "/api/crm/scoring/scores/[id]": r137,
  "/api/crm/search": r138,
  "/api/crm/sequences": r139,
  "/api/crm/sequences/[id]": r140,
  "/api/crm/sequences/[id]/enroll": r141,
  "/api/crm/sequences/enrollments/[id]": r142,
  "/api/crm/settings": r143,
  "/api/crm/stages/[id]": r144,
  "/api/crm/tags": r145,
  "/api/crm/tags/[id]": r146,
  "/api/crm/tags/apply": r147,
  "/api/crm/tags/record": r148,
  "/api/crm/tasks/[id]/files": r149,
  "/api/crm/tasks/[id]/snooze": r150,
  "/api/crm/tasks/[id]/track": r151,
  "/api/crm/tasks/bulk": r152,
  "/api/crm/tasks/digest": r153,
  "/api/crm/tasks/due-count": r154,
  "/api/crm/tasks/projects": r155,
  "/api/crm/tasks/projects/[id]": r156,
  "/api/crm/tasks/queues": r157,
  "/api/crm/tasks/queues/[id]": r158,
  "/api/crm/timeline": r159,
  "/api/crm/trash": r160,
  "/api/crm/trash/[id]/restore": r161,
  "/api/crm/videos": r162,
  "/api/crm/videos/[id]": r163,
  "/api/crm/videos/[id]/file": r164,
  "/api/crm/views": r165,
  "/api/crm/views/[id]": r166,
  "/api/crm/views/tabs": r167,
  "/api/crm/visibility": r168,
  "/api/crm/voice/calls": r169,
  "/api/crm/voice/calls/[id]": r170,
  "/api/crm/voice/calls/[id]/end": r171,
  "/api/crm/voice/calls/[id]/recording": r172,
  "/api/crm/voice/calls/[id]/summarize": r173,
  "/api/crm/voice/fake": r174,
  "/api/crm/voice/settings": r175,
  "/api/crm/workflows": r176,
  "/api/crm/workflows/[id]": r177,
  "/api/crm/workflows/[id]/enroll-existing": r178,
  "/api/crm/workflows/[id]/enrollments/[runId]": r179,
  "/api/crm/workflows/[id]/run": r180,
  "/api/crm/workflows/[id]/toggle": r181,
};
