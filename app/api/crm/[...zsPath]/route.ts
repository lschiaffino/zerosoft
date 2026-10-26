// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/crm/activities/[id]/route';
import * as m1 from '@/lib/routes/crm/activities/[id]/files/route';
import * as m2 from '@/lib/routes/crm/activities/[id]/zoom/route';
import * as m3 from '@/lib/routes/crm/ai/runs/[id]/route';
import * as m4 from '@/lib/routes/crm/ai/runs/[id]/items/[itemId]/route';
import * as m5 from '@/lib/routes/crm/ai/runs/[id]/items/[itemId]/apply/route';
import * as m6 from '@/lib/routes/crm/ai/runs/[id]/items/[itemId]/send/route';
import * as m7 from '@/lib/routes/crm/approval-rules/[id]/route';
import * as m8 from '@/lib/routes/crm/approvals/[id]/route';
import * as m9 from '@/lib/routes/crm/apps/[app]/route';
import * as m10 from '@/lib/routes/crm/apps/[app]/[action]/route';
import * as m11 from '@/lib/routes/crm/companies/[id]/route';
import * as m12 from '@/lib/routes/crm/companies/[id]/enrich/route';
import * as m13 from '@/lib/routes/crm/companies/[id]/files/route';
import * as m14 from '@/lib/routes/crm/contacts/[id]/route';
import * as m15 from '@/lib/routes/crm/contacts/[id]/files/route';
import * as m16 from '@/lib/routes/crm/custom-fields/[id]/route';
import * as m17 from '@/lib/routes/crm/custom-reports/[id]/route';
import * as m18 from '@/lib/routes/crm/d/[token]/file/route';
import * as m19 from '@/lib/routes/crm/d/[token]/track/route';
import * as m20 from '@/lib/routes/crm/dashboards/[id]/route';
import * as m21 from '@/lib/routes/crm/dashboards/[id]/widgets/route';
import * as m22 from '@/lib/routes/crm/dashboards/widgets/[widgetId]/route';
import * as m23 from '@/lib/routes/crm/deals/[id]/route';
import * as m24 from '@/lib/routes/crm/deals/[id]/approvals/route';
import * as m25 from '@/lib/routes/crm/deals/[id]/files/route';
import * as m26 from '@/lib/routes/crm/deals/[id]/line-items/route';
import * as m27 from '@/lib/routes/crm/deals/[id]/line-items/[itemId]/route';
import * as m28 from '@/lib/routes/crm/deals/[id]/move/route';
import * as m29 from '@/lib/routes/crm/deals/[id]/splits/route';
import * as m30 from '@/lib/routes/crm/documents/[id]/route';
import * as m31 from '@/lib/routes/crm/documents/[id]/file/route';
import * as m32 from '@/lib/routes/crm/documents/[id]/links/route';
import * as m33 from '@/lib/routes/crm/email-templates/[id]/route';
import * as m34 from '@/lib/routes/crm/field-permissions/[fieldId]/route';
import * as m35 from '@/lib/routes/crm/forecast/deals/[id]/route';
import * as m36 from '@/lib/routes/crm/forms/[id]/route';
import * as m37 from '@/lib/routes/crm/forms/[id]/submissions/route';
import * as m38 from '@/lib/routes/crm/forms/submit/[key]/route';
import * as m39 from '@/lib/routes/crm/import/jobs/[id]/route';
import * as m40 from '@/lib/routes/crm/import/presets/[id]/route';
import * as m41 from '@/lib/routes/crm/lead-stages/[id]/route';
import * as m42 from '@/lib/routes/crm/leads/[id]/route';
import * as m43 from '@/lib/routes/crm/leads/[id]/convert/route';
import * as m44 from '@/lib/routes/crm/lists/[id]/route';
import * as m45 from '@/lib/routes/crm/lists/[id]/members/route';
import * as m46 from '@/lib/routes/crm/logo/[domain]/route';
import * as m47 from '@/lib/routes/crm/objects/[id]/route';
import * as m48 from '@/lib/routes/crm/objects/[id]/import/route';
import * as m49 from '@/lib/routes/crm/objects/[id]/records/route';
import * as m50 from '@/lib/routes/crm/pipelines/[id]/route';
import * as m51 from '@/lib/routes/crm/pipelines/[id]/stages/route';
import * as m52 from '@/lib/routes/crm/pipelines/[id]/stages/reorder/route';
import * as m53 from '@/lib/routes/crm/playbooks/[id]/route';
import * as m54 from '@/lib/routes/crm/playbooks/[id]/runs/route';
import * as m55 from '@/lib/routes/crm/products/[id]/route';
import * as m56 from '@/lib/routes/crm/quotas/[id]/route';
import * as m57 from '@/lib/routes/crm/quotes/[id]/route';
import * as m58 from '@/lib/routes/crm/quotes/[id]/certificate/route';
import * as m59 from '@/lib/routes/crm/quotes/public/[token]/route';
import * as m60 from '@/lib/routes/crm/quotes/public/[token]/certificate/route';
import * as m61 from '@/lib/routes/crm/quotes/public/[token]/checkout/route';
import * as m62 from '@/lib/routes/crm/records/[id]/route';
import * as m63 from '@/lib/routes/crm/records/[id]/links/route';
import * as m64 from '@/lib/routes/crm/sales-teams/[id]/route';
import * as m65 from '@/lib/routes/crm/scoring/rules/[id]/route';
import * as m66 from '@/lib/routes/crm/scoring/scores/[id]/route';
import * as m67 from '@/lib/routes/crm/sequences/[id]/route';
import * as m68 from '@/lib/routes/crm/sequences/[id]/enroll/route';
import * as m69 from '@/lib/routes/crm/sequences/enrollments/[id]/route';
import * as m70 from '@/lib/routes/crm/stages/[id]/route';
import * as m71 from '@/lib/routes/crm/stripe-webhook/[token]/route';
import * as m72 from '@/lib/routes/crm/t/c/[token]/route';
import * as m73 from '@/lib/routes/crm/t/o/[file]/route';
import * as m74 from '@/lib/routes/crm/t/u/[token]/route';
import * as m75 from '@/lib/routes/crm/tags/[id]/route';
import * as m76 from '@/lib/routes/crm/tasks/[id]/files/route';
import * as m77 from '@/lib/routes/crm/tasks/[id]/snooze/route';
import * as m78 from '@/lib/routes/crm/tasks/projects/[id]/route';
import * as m79 from '@/lib/routes/crm/trash/[id]/restore/route';
import * as m80 from '@/lib/routes/crm/v/[token]/file/route';
import * as m81 from '@/lib/routes/crm/v/[token]/track/route';
import * as m82 from '@/lib/routes/crm/videos/[id]/route';
import * as m83 from '@/lib/routes/crm/videos/[id]/file/route';
import * as m84 from '@/lib/routes/crm/views/[id]/route';
import * as m85 from '@/lib/routes/crm/voice/calls/[id]/route';
import * as m86 from '@/lib/routes/crm/voice/calls/[id]/end/route';
import * as m87 from '@/lib/routes/crm/voice/calls/[id]/recording/route';
import * as m88 from '@/lib/routes/crm/workflows/[id]/route';
import * as m89 from '@/lib/routes/crm/workflows/[id]/run/route';
import * as m90 from '@/lib/routes/crm/workflows/[id]/toggle/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'activities/[id]', mod: m0 }, // lib/routes/crm/activities/[id]
  { pattern: 'activities/[id]/files', mod: m1 }, // lib/routes/crm/activities/[id]/files
  { pattern: 'activities/[id]/zoom', mod: m2 }, // lib/routes/crm/activities/[id]/zoom
  { pattern: 'ai/runs/[id]', mod: m3 }, // lib/routes/crm/ai/runs/[id]
  { pattern: 'ai/runs/[id]/items/[itemId]', mod: m4 }, // lib/routes/crm/ai/runs/[id]/items/[itemId]
  { pattern: 'ai/runs/[id]/items/[itemId]/apply', mod: m5 }, // lib/routes/crm/ai/runs/[id]/items/[itemId]/apply
  { pattern: 'ai/runs/[id]/items/[itemId]/send', mod: m6 }, // lib/routes/crm/ai/runs/[id]/items/[itemId]/send
  { pattern: 'approval-rules/[id]', mod: m7 }, // lib/routes/crm/approval-rules/[id]
  { pattern: 'approvals/[id]', mod: m8 }, // lib/routes/crm/approvals/[id]
  { pattern: 'apps/[app]', mod: m9 }, // lib/routes/crm/apps/[app]
  { pattern: 'apps/[app]/[action]', mod: m10 }, // lib/routes/crm/apps/[app]/[action]
  { pattern: 'companies/[id]', mod: m11 }, // lib/routes/crm/companies/[id]
  { pattern: 'companies/[id]/enrich', mod: m12 }, // lib/routes/crm/companies/[id]/enrich
  { pattern: 'companies/[id]/files', mod: m13 }, // lib/routes/crm/companies/[id]/files
  { pattern: 'contacts/[id]', mod: m14 }, // lib/routes/crm/contacts/[id]
  { pattern: 'contacts/[id]/files', mod: m15 }, // lib/routes/crm/contacts/[id]/files
  { pattern: 'custom-fields/[id]', mod: m16 }, // lib/routes/crm/custom-fields/[id]
  { pattern: 'custom-reports/[id]', mod: m17 }, // lib/routes/crm/custom-reports/[id]
  { pattern: 'd/[token]/file', mod: m18 }, // lib/routes/crm/d/[token]/file
  { pattern: 'd/[token]/track', mod: m19 }, // lib/routes/crm/d/[token]/track
  { pattern: 'dashboards/[id]', mod: m20 }, // lib/routes/crm/dashboards/[id]
  { pattern: 'dashboards/[id]/widgets', mod: m21 }, // lib/routes/crm/dashboards/[id]/widgets
  { pattern: 'dashboards/widgets/[widgetId]', mod: m22 }, // lib/routes/crm/dashboards/widgets/[widgetId]
  { pattern: 'deals/[id]', mod: m23 }, // lib/routes/crm/deals/[id]
  { pattern: 'deals/[id]/approvals', mod: m24 }, // lib/routes/crm/deals/[id]/approvals
  { pattern: 'deals/[id]/files', mod: m25 }, // lib/routes/crm/deals/[id]/files
  { pattern: 'deals/[id]/line-items', mod: m26 }, // lib/routes/crm/deals/[id]/line-items
  { pattern: 'deals/[id]/line-items/[itemId]', mod: m27 }, // lib/routes/crm/deals/[id]/line-items/[itemId]
  { pattern: 'deals/[id]/move', mod: m28 }, // lib/routes/crm/deals/[id]/move
  { pattern: 'deals/[id]/splits', mod: m29 }, // lib/routes/crm/deals/[id]/splits
  { pattern: 'documents/[id]', mod: m30 }, // lib/routes/crm/documents/[id]
  { pattern: 'documents/[id]/file', mod: m31 }, // lib/routes/crm/documents/[id]/file
  { pattern: 'documents/[id]/links', mod: m32 }, // lib/routes/crm/documents/[id]/links
  { pattern: 'email-templates/[id]', mod: m33 }, // lib/routes/crm/email-templates/[id]
  { pattern: 'field-permissions/[fieldId]', mod: m34 }, // lib/routes/crm/field-permissions/[fieldId]
  { pattern: 'forecast/deals/[id]', mod: m35 }, // lib/routes/crm/forecast/deals/[id]
  { pattern: 'forms/[id]', mod: m36 }, // lib/routes/crm/forms/[id]
  { pattern: 'forms/[id]/submissions', mod: m37 }, // lib/routes/crm/forms/[id]/submissions
  { pattern: 'forms/submit/[key]', mod: m38 }, // lib/routes/crm/forms/submit/[key]
  { pattern: 'import/jobs/[id]', mod: m39 }, // lib/routes/crm/import/jobs/[id]
  { pattern: 'import/presets/[id]', mod: m40 }, // lib/routes/crm/import/presets/[id]
  { pattern: 'lead-stages/[id]', mod: m41 }, // lib/routes/crm/lead-stages/[id]
  { pattern: 'leads/[id]', mod: m42 }, // lib/routes/crm/leads/[id]
  { pattern: 'leads/[id]/convert', mod: m43 }, // lib/routes/crm/leads/[id]/convert
  { pattern: 'lists/[id]', mod: m44 }, // lib/routes/crm/lists/[id]
  { pattern: 'lists/[id]/members', mod: m45 }, // lib/routes/crm/lists/[id]/members
  { pattern: 'logo/[domain]', mod: m46 }, // lib/routes/crm/logo/[domain]
  { pattern: 'objects/[id]', mod: m47 }, // lib/routes/crm/objects/[id]
  { pattern: 'objects/[id]/import', mod: m48 }, // lib/routes/crm/objects/[id]/import
  { pattern: 'objects/[id]/records', mod: m49 }, // lib/routes/crm/objects/[id]/records
  { pattern: 'pipelines/[id]', mod: m50 }, // lib/routes/crm/pipelines/[id]
  { pattern: 'pipelines/[id]/stages', mod: m51 }, // lib/routes/crm/pipelines/[id]/stages
  { pattern: 'pipelines/[id]/stages/reorder', mod: m52 }, // lib/routes/crm/pipelines/[id]/stages/reorder
  { pattern: 'playbooks/[id]', mod: m53 }, // lib/routes/crm/playbooks/[id]
  { pattern: 'playbooks/[id]/runs', mod: m54 }, // lib/routes/crm/playbooks/[id]/runs
  { pattern: 'products/[id]', mod: m55 }, // lib/routes/crm/products/[id]
  { pattern: 'quotas/[id]', mod: m56 }, // lib/routes/crm/quotas/[id]
  { pattern: 'quotes/[id]', mod: m57 }, // lib/routes/crm/quotes/[id]
  { pattern: 'quotes/[id]/certificate', mod: m58 }, // lib/routes/crm/quotes/[id]/certificate
  { pattern: 'quotes/public/[token]', mod: m59 }, // lib/routes/crm/quotes/public/[token]
  { pattern: 'quotes/public/[token]/certificate', mod: m60 }, // lib/routes/crm/quotes/public/[token]/certificate
  { pattern: 'quotes/public/[token]/checkout', mod: m61 }, // lib/routes/crm/quotes/public/[token]/checkout
  { pattern: 'records/[id]', mod: m62 }, // lib/routes/crm/records/[id]
  { pattern: 'records/[id]/links', mod: m63 }, // lib/routes/crm/records/[id]/links
  { pattern: 'sales-teams/[id]', mod: m64 }, // lib/routes/crm/sales-teams/[id]
  { pattern: 'scoring/rules/[id]', mod: m65 }, // lib/routes/crm/scoring/rules/[id]
  { pattern: 'scoring/scores/[id]', mod: m66 }, // lib/routes/crm/scoring/scores/[id]
  { pattern: 'sequences/[id]', mod: m67 }, // lib/routes/crm/sequences/[id]
  { pattern: 'sequences/[id]/enroll', mod: m68 }, // lib/routes/crm/sequences/[id]/enroll
  { pattern: 'sequences/enrollments/[id]', mod: m69 }, // lib/routes/crm/sequences/enrollments/[id]
  { pattern: 'stages/[id]', mod: m70 }, // lib/routes/crm/stages/[id]
  { pattern: 'stripe-webhook/[token]', mod: m71 }, // lib/routes/crm/stripe-webhook/[token]
  { pattern: 't/c/[token]', mod: m72 }, // lib/routes/crm/t/c/[token]
  { pattern: 't/o/[file]', mod: m73 }, // lib/routes/crm/t/o/[file]
  { pattern: 't/u/[token]', mod: m74 }, // lib/routes/crm/t/u/[token]
  { pattern: 'tags/[id]', mod: m75 }, // lib/routes/crm/tags/[id]
  { pattern: 'tasks/[id]/files', mod: m76 }, // lib/routes/crm/tasks/[id]/files
  { pattern: 'tasks/[id]/snooze', mod: m77 }, // lib/routes/crm/tasks/[id]/snooze
  { pattern: 'tasks/projects/[id]', mod: m78 }, // lib/routes/crm/tasks/projects/[id]
  { pattern: 'trash/[id]/restore', mod: m79 }, // lib/routes/crm/trash/[id]/restore
  { pattern: 'v/[token]/file', mod: m80 }, // lib/routes/crm/v/[token]/file
  { pattern: 'v/[token]/track', mod: m81 }, // lib/routes/crm/v/[token]/track
  { pattern: 'videos/[id]', mod: m82 }, // lib/routes/crm/videos/[id]
  { pattern: 'videos/[id]/file', mod: m83 }, // lib/routes/crm/videos/[id]/file
  { pattern: 'views/[id]', mod: m84 }, // lib/routes/crm/views/[id]
  { pattern: 'voice/calls/[id]', mod: m85 }, // lib/routes/crm/voice/calls/[id]
  { pattern: 'voice/calls/[id]/end', mod: m86 }, // lib/routes/crm/voice/calls/[id]/end
  { pattern: 'voice/calls/[id]/recording', mod: m87 }, // lib/routes/crm/voice/calls/[id]/recording
  { pattern: 'workflows/[id]', mod: m88 }, // lib/routes/crm/workflows/[id]
  { pattern: 'workflows/[id]/run', mod: m89 }, // lib/routes/crm/workflows/[id]/run
  { pattern: 'workflows/[id]/toggle', mod: m90 }, // lib/routes/crm/workflows/[id]/toggle
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
