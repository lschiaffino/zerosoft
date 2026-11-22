// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/crm/activities/route";
import * as r1 from "@/lib/routes/crm/activities/[id]/route";
import * as r2 from "@/lib/routes/crm/activities/[id]/files/route";
import * as r3 from "@/lib/routes/crm/activities/[id]/zoom/route";
import * as r4 from "@/app/api/crm/ai/assistant/route";
import * as r5 from "@/app/api/crm/ai/call-summary/route";
import * as r6 from "@/app/api/crm/ai/deal-score/route";
import * as r7 from "@/app/api/crm/ai/deal-score/batch/route";
import * as r8 from "@/app/api/crm/ai/runs/route";
import * as r9 from "@/lib/routes/crm/ai/runs/[id]/route";
import * as r10 from "@/app/api/crm/ai/runs/[id]/apply-all/route";
import * as r11 from "@/lib/routes/crm/ai/runs/[id]/items/[itemId]/route";
import * as r12 from "@/lib/routes/crm/ai/runs/[id]/items/[itemId]/apply/route";
import * as r13 from "@/lib/routes/crm/ai/runs/[id]/items/[itemId]/send/route";
import * as r14 from "@/app/api/crm/ai/runs/[id]/step/route";
import * as r15 from "@/app/api/crm/ai/summary/route";
import * as r16 from "@/app/api/crm/approval-rules/route";
import * as r17 from "@/lib/routes/crm/approval-rules/[id]/route";
import * as r18 from "@/lib/routes/crm/approvals/[id]/route";
import * as r19 from "@/app/api/crm/apps/route";
import * as r20 from "@/app/api/crm/assignment/route";
import * as r21 from "@/app/api/crm/assignment/availability/route";
import * as r22 from "@/app/api/crm/association-labels/route";
import * as r23 from "@/app/api/crm/associations/route";
import * as r24 from "@/app/api/crm/companies/route";
import * as r25 from "@/lib/routes/crm/companies/[id]/route";
import * as r26 from "@/lib/routes/crm/companies/[id]/enrich/route";
import * as r27 from "@/lib/routes/crm/companies/[id]/files/route";
import * as r28 from "@/app/api/crm/companies/bulk/route";
import * as r29 from "@/app/api/crm/companies/duplicates/route";
import * as r30 from "@/app/api/crm/companies/enrich/route";
import * as r31 from "@/app/api/crm/companies/merge/route";
import * as r32 from "@/app/api/crm/contacts/route";
import * as r33 from "@/lib/routes/crm/contacts/[id]/route";
import * as r34 from "@/lib/routes/crm/contacts/[id]/files/route";
import * as r35 from "@/app/api/crm/contacts/bulk/route";
import * as r36 from "@/app/api/crm/contacts/duplicates/route";
import * as r37 from "@/app/api/crm/contacts/merge/route";
import * as r38 from "@/app/api/crm/create-form/route";
import * as r39 from "@/app/api/crm/custom-fields/route";
import * as r40 from "@/lib/routes/crm/custom-fields/[id]/route";
import * as r41 from "@/app/api/crm/custom-reports/route";
import * as r42 from "@/lib/routes/crm/custom-reports/[id]/route";
import * as r43 from "@/app/api/crm/custom-reports/run/route";
import * as r44 from "@/app/api/crm/dashboards/route";
import * as r45 from "@/lib/routes/crm/dashboards/[id]/route";
import * as r46 from "@/lib/routes/crm/dashboards/[id]/widgets/route";
import * as r47 from "@/app/api/crm/dashboards/data/route";
import * as r48 from "@/lib/routes/crm/dashboards/widgets/[widgetId]/route";
import * as r49 from "@/app/api/crm/deals/route";
import * as r50 from "@/lib/routes/crm/deals/[id]/route";
import * as r51 from "@/lib/routes/crm/deals/[id]/approvals/route";
import * as r52 from "@/lib/routes/crm/deals/[id]/files/route";
import * as r53 from "@/lib/routes/crm/deals/[id]/line-items/route";
import * as r54 from "@/lib/routes/crm/deals/[id]/line-items/[itemId]/route";
import * as r55 from "@/lib/routes/crm/deals/[id]/move/route";
import * as r56 from "@/lib/routes/crm/deals/[id]/splits/route";
import * as r57 from "@/app/api/crm/deals/bulk/route";
import * as r58 from "@/app/api/crm/documents/route";
import * as r59 from "@/lib/routes/crm/documents/[id]/route";
import * as r60 from "@/lib/routes/crm/documents/[id]/file/route";
import * as r61 from "@/lib/routes/crm/documents/[id]/links/route";
import * as r62 from "@/app/api/crm/email-settings/route";
import * as r63 from "@/app/api/crm/email-templates/route";
import * as r64 from "@/lib/routes/crm/email-templates/[id]/route";
import * as r65 from "@/app/api/crm/email-templates/preview/route";
import * as r66 from "@/app/api/crm/emails/route";
import * as r67 from "@/app/api/crm/emails/draft/route";
import * as r68 from "@/app/api/crm/exchange-rates/route";
import * as r69 from "@/app/api/crm/export/route";
import * as r70 from "@/app/api/crm/extension/download/route";
import * as r71 from "@/app/api/crm/field-permissions/route";
import * as r72 from "@/lib/routes/crm/field-permissions/[fieldId]/route";
import * as r73 from "@/app/api/crm/forecast/route";
import * as r74 from "@/lib/routes/crm/forecast/deals/[id]/route";
import * as r75 from "@/app/api/crm/forecast/submissions/route";
import * as r76 from "@/app/api/crm/forms/route";
import * as r77 from "@/lib/routes/crm/forms/[id]/route";
import * as r78 from "@/lib/routes/crm/forms/[id]/submissions/route";
import * as r79 from "@/app/api/crm/history/route";
import * as r80 from "@/app/api/crm/hubspot-sync/route";
import * as r81 from "@/app/api/crm/hubspot-sync/inbound/route";
import * as r82 from "@/app/api/crm/hubspot-sync/inbound/run/route";
import * as r83 from "@/app/api/crm/hubspot-sync/outbound/route";
import * as r84 from "@/app/api/crm/hubspot-sync/preview/route";
import * as r85 from "@/app/api/crm/hubspot-sync/preview/run/route";
import * as r86 from "@/app/api/crm/import/route";
import * as r87 from "@/app/api/crm/import/jobs/route";
import * as r88 from "@/lib/routes/crm/import/jobs/[id]/route";
import * as r89 from "@/app/api/crm/import/jobs/[id]/run/route";
import * as r90 from "@/app/api/crm/import/presets/route";
import * as r91 from "@/lib/routes/crm/import/presets/[id]/route";
import * as r92 from "@/app/api/crm/lead-stages/route";
import * as r93 from "@/lib/routes/crm/lead-stages/[id]/route";
import * as r94 from "@/app/api/crm/leads/route";
import * as r95 from "@/lib/routes/crm/leads/[id]/route";
import * as r96 from "@/lib/routes/crm/leads/[id]/convert/route";
import * as r97 from "@/app/api/crm/lists/route";
import * as r98 from "@/lib/routes/crm/lists/[id]/route";
import * as r99 from "@/lib/routes/crm/lists/[id]/members/route";
import * as r100 from "@/lib/routes/crm/logo/[domain]/route";
import * as r101 from "@/app/api/crm/meeting-links/route";
import * as r102 from "@/app/api/crm/objects/route";
import * as r103 from "@/lib/routes/crm/objects/[id]/route";
import * as r104 from "@/lib/routes/crm/objects/[id]/import/route";
import * as r105 from "@/lib/routes/crm/objects/[id]/records/route";
import * as r106 from "@/app/api/crm/pipelines/route";
import * as r107 from "@/lib/routes/crm/pipelines/[id]/route";
import * as r108 from "@/lib/routes/crm/pipelines/[id]/stages/route";
import * as r109 from "@/lib/routes/crm/pipelines/[id]/stages/reorder/route";
import * as r110 from "@/app/api/crm/playbooks/route";
import * as r111 from "@/lib/routes/crm/playbooks/[id]/route";
import * as r112 from "@/lib/routes/crm/playbooks/[id]/runs/route";
import * as r113 from "@/app/api/crm/products/route";
import * as r114 from "@/lib/routes/crm/products/[id]/route";
import * as r115 from "@/app/api/crm/quotas/route";
import * as r116 from "@/lib/routes/crm/quotas/[id]/route";
import * as r117 from "@/app/api/crm/quotes/route";
import * as r118 from "@/lib/routes/crm/quotes/[id]/route";
import * as r119 from "@/lib/routes/crm/quotes/[id]/certificate/route";
import * as r120 from "@/lib/routes/crm/records/[id]/route";
import * as r121 from "@/lib/routes/crm/records/[id]/links/route";
import * as r122 from "@/app/api/crm/reports/route";
import * as r123 from "@/app/api/crm/sales-teams/route";
import * as r124 from "@/lib/routes/crm/sales-teams/[id]/route";
import * as r125 from "@/app/api/crm/scoring/recalculate/route";
import * as r126 from "@/app/api/crm/scoring/rules/route";
import * as r127 from "@/lib/routes/crm/scoring/rules/[id]/route";
import * as r128 from "@/app/api/crm/scoring/scores/route";
import * as r129 from "@/lib/routes/crm/scoring/scores/[id]/route";
import * as r130 from "@/app/api/crm/search/route";
import * as r131 from "@/app/api/crm/sequences/route";
import * as r132 from "@/lib/routes/crm/sequences/[id]/route";
import * as r133 from "@/lib/routes/crm/sequences/[id]/enroll/route";
import * as r134 from "@/lib/routes/crm/sequences/enrollments/[id]/route";
import * as r135 from "@/app/api/crm/settings/route";
import * as r136 from "@/lib/routes/crm/stages/[id]/route";
import * as r137 from "@/app/api/crm/tags/route";
import * as r138 from "@/lib/routes/crm/tags/[id]/route";
import * as r139 from "@/app/api/crm/tags/apply/route";
import * as r140 from "@/app/api/crm/tags/record/route";
import * as r141 from "@/lib/routes/crm/tasks/[id]/files/route";
import * as r142 from "@/lib/routes/crm/tasks/[id]/snooze/route";
import * as r143 from "@/lib/routes/crm/tasks/[id]/track/route";
import * as r144 from "@/app/api/crm/tasks/due-count/route";
import * as r145 from "@/app/api/crm/tasks/projects/route";
import * as r146 from "@/lib/routes/crm/tasks/projects/[id]/route";
import * as r147 from "@/app/api/crm/timeline/route";
import * as r148 from "@/app/api/crm/trash/route";
import * as r149 from "@/lib/routes/crm/trash/[id]/restore/route";
import * as r150 from "@/app/api/crm/videos/route";
import * as r151 from "@/lib/routes/crm/videos/[id]/route";
import * as r152 from "@/lib/routes/crm/videos/[id]/file/route";
import * as r153 from "@/app/api/crm/views/route";
import * as r154 from "@/lib/routes/crm/views/[id]/route";
import * as r155 from "@/app/api/crm/visibility/route";
import * as r156 from "@/app/api/crm/voice/calls/route";
import * as r157 from "@/lib/routes/crm/voice/calls/[id]/route";
import * as r158 from "@/lib/routes/crm/voice/calls/[id]/end/route";
import * as r159 from "@/lib/routes/crm/voice/calls/[id]/recording/route";
import * as r160 from "@/app/api/crm/voice/calls/[id]/summarize/route";
import * as r161 from "@/app/api/crm/voice/fake/route";
import * as r162 from "@/app/api/crm/voice/settings/route";
import * as r163 from "@/app/api/crm/workflows/route";
import * as r164 from "@/lib/routes/crm/workflows/[id]/route";
import * as r165 from "@/lib/routes/crm/workflows/[id]/run/route";
import * as r166 from "@/lib/routes/crm/workflows/[id]/toggle/route";

export const routes: Record<string, unknown> = {
  "/api/crm/activities": r0,
  "/api/crm/activities/[id]": r1,
  "/api/crm/activities/[id]/files": r2,
  "/api/crm/activities/[id]/zoom": r3,
  "/api/crm/ai/assistant": r4,
  "/api/crm/ai/call-summary": r5,
  "/api/crm/ai/deal-score": r6,
  "/api/crm/ai/deal-score/batch": r7,
  "/api/crm/ai/runs": r8,
  "/api/crm/ai/runs/[id]": r9,
  "/api/crm/ai/runs/[id]/apply-all": r10,
  "/api/crm/ai/runs/[id]/items/[itemId]": r11,
  "/api/crm/ai/runs/[id]/items/[itemId]/apply": r12,
  "/api/crm/ai/runs/[id]/items/[itemId]/send": r13,
  "/api/crm/ai/runs/[id]/step": r14,
  "/api/crm/ai/summary": r15,
  "/api/crm/approval-rules": r16,
  "/api/crm/approval-rules/[id]": r17,
  "/api/crm/approvals/[id]": r18,
  "/api/crm/apps": r19,
  "/api/crm/assignment": r20,
  "/api/crm/assignment/availability": r21,
  "/api/crm/association-labels": r22,
  "/api/crm/associations": r23,
  "/api/crm/companies": r24,
  "/api/crm/companies/[id]": r25,
  "/api/crm/companies/[id]/enrich": r26,
  "/api/crm/companies/[id]/files": r27,
  "/api/crm/companies/bulk": r28,
  "/api/crm/companies/duplicates": r29,
  "/api/crm/companies/enrich": r30,
  "/api/crm/companies/merge": r31,
  "/api/crm/contacts": r32,
  "/api/crm/contacts/[id]": r33,
  "/api/crm/contacts/[id]/files": r34,
  "/api/crm/contacts/bulk": r35,
  "/api/crm/contacts/duplicates": r36,
  "/api/crm/contacts/merge": r37,
  "/api/crm/create-form": r38,
  "/api/crm/custom-fields": r39,
  "/api/crm/custom-fields/[id]": r40,
  "/api/crm/custom-reports": r41,
  "/api/crm/custom-reports/[id]": r42,
  "/api/crm/custom-reports/run": r43,
  "/api/crm/dashboards": r44,
  "/api/crm/dashboards/[id]": r45,
  "/api/crm/dashboards/[id]/widgets": r46,
  "/api/crm/dashboards/data": r47,
  "/api/crm/dashboards/widgets/[widgetId]": r48,
  "/api/crm/deals": r49,
  "/api/crm/deals/[id]": r50,
  "/api/crm/deals/[id]/approvals": r51,
  "/api/crm/deals/[id]/files": r52,
  "/api/crm/deals/[id]/line-items": r53,
  "/api/crm/deals/[id]/line-items/[itemId]": r54,
  "/api/crm/deals/[id]/move": r55,
  "/api/crm/deals/[id]/splits": r56,
  "/api/crm/deals/bulk": r57,
  "/api/crm/documents": r58,
  "/api/crm/documents/[id]": r59,
  "/api/crm/documents/[id]/file": r60,
  "/api/crm/documents/[id]/links": r61,
  "/api/crm/email-settings": r62,
  "/api/crm/email-templates": r63,
  "/api/crm/email-templates/[id]": r64,
  "/api/crm/email-templates/preview": r65,
  "/api/crm/emails": r66,
  "/api/crm/emails/draft": r67,
  "/api/crm/exchange-rates": r68,
  "/api/crm/export": r69,
  "/api/crm/extension/download": r70,
  "/api/crm/field-permissions": r71,
  "/api/crm/field-permissions/[fieldId]": r72,
  "/api/crm/forecast": r73,
  "/api/crm/forecast/deals/[id]": r74,
  "/api/crm/forecast/submissions": r75,
  "/api/crm/forms": r76,
  "/api/crm/forms/[id]": r77,
  "/api/crm/forms/[id]/submissions": r78,
  "/api/crm/history": r79,
  "/api/crm/hubspot-sync": r80,
  "/api/crm/hubspot-sync/inbound": r81,
  "/api/crm/hubspot-sync/inbound/run": r82,
  "/api/crm/hubspot-sync/outbound": r83,
  "/api/crm/hubspot-sync/preview": r84,
  "/api/crm/hubspot-sync/preview/run": r85,
  "/api/crm/import": r86,
  "/api/crm/import/jobs": r87,
  "/api/crm/import/jobs/[id]": r88,
  "/api/crm/import/jobs/[id]/run": r89,
  "/api/crm/import/presets": r90,
  "/api/crm/import/presets/[id]": r91,
  "/api/crm/lead-stages": r92,
  "/api/crm/lead-stages/[id]": r93,
  "/api/crm/leads": r94,
  "/api/crm/leads/[id]": r95,
  "/api/crm/leads/[id]/convert": r96,
  "/api/crm/lists": r97,
  "/api/crm/lists/[id]": r98,
  "/api/crm/lists/[id]/members": r99,
  "/api/crm/logo/[domain]": r100,
  "/api/crm/meeting-links": r101,
  "/api/crm/objects": r102,
  "/api/crm/objects/[id]": r103,
  "/api/crm/objects/[id]/import": r104,
  "/api/crm/objects/[id]/records": r105,
  "/api/crm/pipelines": r106,
  "/api/crm/pipelines/[id]": r107,
  "/api/crm/pipelines/[id]/stages": r108,
  "/api/crm/pipelines/[id]/stages/reorder": r109,
  "/api/crm/playbooks": r110,
  "/api/crm/playbooks/[id]": r111,
  "/api/crm/playbooks/[id]/runs": r112,
  "/api/crm/products": r113,
  "/api/crm/products/[id]": r114,
  "/api/crm/quotas": r115,
  "/api/crm/quotas/[id]": r116,
  "/api/crm/quotes": r117,
  "/api/crm/quotes/[id]": r118,
  "/api/crm/quotes/[id]/certificate": r119,
  "/api/crm/records/[id]": r120,
  "/api/crm/records/[id]/links": r121,
  "/api/crm/reports": r122,
  "/api/crm/sales-teams": r123,
  "/api/crm/sales-teams/[id]": r124,
  "/api/crm/scoring/recalculate": r125,
  "/api/crm/scoring/rules": r126,
  "/api/crm/scoring/rules/[id]": r127,
  "/api/crm/scoring/scores": r128,
  "/api/crm/scoring/scores/[id]": r129,
  "/api/crm/search": r130,
  "/api/crm/sequences": r131,
  "/api/crm/sequences/[id]": r132,
  "/api/crm/sequences/[id]/enroll": r133,
  "/api/crm/sequences/enrollments/[id]": r134,
  "/api/crm/settings": r135,
  "/api/crm/stages/[id]": r136,
  "/api/crm/tags": r137,
  "/api/crm/tags/[id]": r138,
  "/api/crm/tags/apply": r139,
  "/api/crm/tags/record": r140,
  "/api/crm/tasks/[id]/files": r141,
  "/api/crm/tasks/[id]/snooze": r142,
  "/api/crm/tasks/[id]/track": r143,
  "/api/crm/tasks/due-count": r144,
  "/api/crm/tasks/projects": r145,
  "/api/crm/tasks/projects/[id]": r146,
  "/api/crm/timeline": r147,
  "/api/crm/trash": r148,
  "/api/crm/trash/[id]/restore": r149,
  "/api/crm/videos": r150,
  "/api/crm/videos/[id]": r151,
  "/api/crm/videos/[id]/file": r152,
  "/api/crm/views": r153,
  "/api/crm/views/[id]": r154,
  "/api/crm/visibility": r155,
  "/api/crm/voice/calls": r156,
  "/api/crm/voice/calls/[id]": r157,
  "/api/crm/voice/calls/[id]/end": r158,
  "/api/crm/voice/calls/[id]/recording": r159,
  "/api/crm/voice/calls/[id]/summarize": r160,
  "/api/crm/voice/fake": r161,
  "/api/crm/voice/settings": r162,
  "/api/crm/workflows": r163,
  "/api/crm/workflows/[id]": r164,
  "/api/crm/workflows/[id]/run": r165,
  "/api/crm/workflows/[id]/toggle": r166,
};
