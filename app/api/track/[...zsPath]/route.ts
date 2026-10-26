// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/track/agent-apps/[id]/route';
import * as m1 from '@/lib/routes/track/agent-sessions/[id]/route';
import * as m2 from '@/lib/routes/track/customer-requests/[id]/route';
import * as m3 from '@/lib/routes/track/cycles/[id]/route';
import * as m4 from '@/lib/routes/track/cycles/[id]/complete/route';
import * as m5 from '@/lib/routes/track/cycles/[id]/metrics/route';
import * as m6 from '@/lib/routes/track/dashboard-widgets/[id]/route';
import * as m7 from '@/lib/routes/track/dashboards/[id]/route';
import * as m8 from '@/lib/routes/track/dashboards/[id]/widgets/route';
import * as m9 from '@/lib/routes/track/github/webhook/[hookId]/route';
import * as m10 from '@/lib/routes/track/initiatives/[id]/route';
import * as m11 from '@/lib/routes/track/integrations/[provider]/route';
import * as m12 from '@/lib/routes/track/issues/[id]/route';
import * as m13 from '@/lib/routes/track/issues/[id]/activities/route';
import * as m14 from '@/lib/routes/track/issues/[id]/agent/route';
import * as m15 from '@/lib/routes/track/issues/[id]/ai/suggestions/route';
import * as m16 from '@/lib/routes/track/issues/[id]/ai/suggestions/[sid]/route';
import * as m17 from '@/lib/routes/track/issues/[id]/ai/summary/route';
import * as m18 from '@/lib/routes/track/issues/[id]/attachments/route';
import * as m19 from '@/lib/routes/track/issues/[id]/children/route';
import * as m20 from '@/lib/routes/track/issues/[id]/comments/route';
import * as m21 from '@/lib/routes/track/issues/[id]/comments/[commentId]/route';
import * as m22 from '@/lib/routes/track/issues/[id]/comments/[commentId]/reactions/route';
import * as m23 from '@/lib/routes/track/issues/[id]/comments/[commentId]/resolve/route';
import * as m24 from '@/lib/routes/track/issues/[id]/customer-requests/route';
import * as m25 from '@/lib/routes/track/issues/[id]/duplicates/route';
import * as m26 from '@/lib/routes/track/issues/[id]/favorite/route';
import * as m27 from '@/lib/routes/track/issues/[id]/github/route';
import * as m28 from '@/lib/routes/track/issues/[id]/insights/route';
import * as m29 from '@/lib/routes/track/issues/[id]/links/route';
import * as m30 from '@/lib/routes/track/issues/[id]/move/route';
import * as m31 from '@/lib/routes/track/issues/[id]/relations/route';
import * as m32 from '@/lib/routes/track/issues/[id]/reminder/route';
import * as m33 from '@/lib/routes/track/issues/[id]/snooze/route';
import * as m34 from '@/lib/routes/track/issues/[id]/subscription/route';
import * as m35 from '@/lib/routes/track/issues/[id]/triage/route';
import * as m36 from '@/lib/routes/track/labels/[id]/route';
import * as m37 from '@/lib/routes/track/milestones/[id]/route';
import * as m38 from '@/lib/routes/track/plan-milestones/[id]/route';
import * as m39 from '@/lib/routes/track/plan-updates/[id]/route';
import * as m40 from '@/lib/routes/track/plan-updates/[id]/comments/route';
import * as m41 from '@/lib/routes/track/plans/[id]/route';
import * as m42 from '@/lib/routes/track/plans/[id]/follow/route';
import * as m43 from '@/lib/routes/track/plans/[id]/issues/route';
import * as m44 from '@/lib/routes/track/plans/[id]/milestones/route';
import * as m45 from '@/lib/routes/track/plans/[id]/updates/route';
import * as m46 from '@/lib/routes/track/projects/[id]/route';
import * as m47 from '@/lib/routes/track/projects/[id]/ai/issue-from-text/route';
import * as m48 from '@/lib/routes/track/projects/[id]/ai/summary/route';
import * as m49 from '@/lib/routes/track/projects/[id]/automation/route';
import * as m50 from '@/lib/routes/track/projects/[id]/cycles/route';
import * as m51 from '@/lib/routes/track/projects/[id]/issues/route';
import * as m52 from '@/lib/routes/track/projects/[id]/members/route';
import * as m53 from '@/lib/routes/track/projects/[id]/milestones/route';
import * as m54 from '@/lib/routes/track/projects/[id]/recurring/route';
import * as m55 from '@/lib/routes/track/projects/[id]/statuses/route';
import * as m56 from '@/lib/routes/track/projects/[id]/statuses/reorder/route';
import * as m57 from '@/lib/routes/track/projects/[id]/templates/route';
import * as m58 from '@/lib/routes/track/projects/[id]/triage/route';
import * as m59 from '@/lib/routes/track/projects/[id]/triage-rules/route';
import * as m60 from '@/lib/routes/track/projects/[id]/triage-settings/route';
import * as m61 from '@/lib/routes/track/projects/[id]/views/route';
import * as m62 from '@/lib/routes/track/recurring/[id]/route';
import * as m63 from '@/lib/routes/track/sentry/webhook/[id]/route';
import * as m64 from '@/lib/routes/track/statuses/[id]/route';
import * as m65 from '@/lib/routes/track/templates/[id]/route';
import * as m66 from '@/lib/routes/track/triage-rules/[id]/route';
import * as m67 from '@/lib/routes/track/views/[id]/route';
import * as m68 from '@/lib/routes/track/views/[id]/default/route';
import * as m69 from '@/lib/routes/track/views/[id]/favorite/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'agent-apps/[id]', mod: m0 }, // lib/routes/track/agent-apps/[id]
  { pattern: 'agent-sessions/[id]', mod: m1 }, // lib/routes/track/agent-sessions/[id]
  { pattern: 'customer-requests/[id]', mod: m2 }, // lib/routes/track/customer-requests/[id]
  { pattern: 'cycles/[id]', mod: m3 }, // lib/routes/track/cycles/[id]
  { pattern: 'cycles/[id]/complete', mod: m4 }, // lib/routes/track/cycles/[id]/complete
  { pattern: 'cycles/[id]/metrics', mod: m5 }, // lib/routes/track/cycles/[id]/metrics
  { pattern: 'dashboard-widgets/[id]', mod: m6 }, // lib/routes/track/dashboard-widgets/[id]
  { pattern: 'dashboards/[id]', mod: m7 }, // lib/routes/track/dashboards/[id]
  { pattern: 'dashboards/[id]/widgets', mod: m8 }, // lib/routes/track/dashboards/[id]/widgets
  { pattern: 'github/webhook/[hookId]', mod: m9 }, // lib/routes/track/github/webhook/[hookId]
  { pattern: 'initiatives/[id]', mod: m10 }, // lib/routes/track/initiatives/[id]
  { pattern: 'integrations/[provider]', mod: m11 }, // lib/routes/track/integrations/[provider]
  { pattern: 'issues/[id]', mod: m12 }, // lib/routes/track/issues/[id]
  { pattern: 'issues/[id]/activities', mod: m13 }, // lib/routes/track/issues/[id]/activities
  { pattern: 'issues/[id]/agent', mod: m14 }, // lib/routes/track/issues/[id]/agent
  { pattern: 'issues/[id]/ai/suggestions', mod: m15 }, // lib/routes/track/issues/[id]/ai/suggestions
  { pattern: 'issues/[id]/ai/suggestions/[sid]', mod: m16 }, // lib/routes/track/issues/[id]/ai/suggestions/[sid]
  { pattern: 'issues/[id]/ai/summary', mod: m17 }, // lib/routes/track/issues/[id]/ai/summary
  { pattern: 'issues/[id]/attachments', mod: m18 }, // lib/routes/track/issues/[id]/attachments
  { pattern: 'issues/[id]/children', mod: m19 }, // lib/routes/track/issues/[id]/children
  { pattern: 'issues/[id]/comments', mod: m20 }, // lib/routes/track/issues/[id]/comments
  { pattern: 'issues/[id]/comments/[commentId]', mod: m21 }, // lib/routes/track/issues/[id]/comments/[commentId]
  { pattern: 'issues/[id]/comments/[commentId]/reactions', mod: m22 }, // lib/routes/track/issues/[id]/comments/[commentId]/reactions
  { pattern: 'issues/[id]/comments/[commentId]/resolve', mod: m23 }, // lib/routes/track/issues/[id]/comments/[commentId]/resolve
  { pattern: 'issues/[id]/customer-requests', mod: m24 }, // lib/routes/track/issues/[id]/customer-requests
  { pattern: 'issues/[id]/duplicates', mod: m25 }, // lib/routes/track/issues/[id]/duplicates
  { pattern: 'issues/[id]/favorite', mod: m26 }, // lib/routes/track/issues/[id]/favorite
  { pattern: 'issues/[id]/github', mod: m27 }, // lib/routes/track/issues/[id]/github
  { pattern: 'issues/[id]/insights', mod: m28 }, // lib/routes/track/issues/[id]/insights
  { pattern: 'issues/[id]/links', mod: m29 }, // lib/routes/track/issues/[id]/links
  { pattern: 'issues/[id]/move', mod: m30 }, // lib/routes/track/issues/[id]/move
  { pattern: 'issues/[id]/relations', mod: m31 }, // lib/routes/track/issues/[id]/relations
  { pattern: 'issues/[id]/reminder', mod: m32 }, // lib/routes/track/issues/[id]/reminder
  { pattern: 'issues/[id]/snooze', mod: m33 }, // lib/routes/track/issues/[id]/snooze
  { pattern: 'issues/[id]/subscription', mod: m34 }, // lib/routes/track/issues/[id]/subscription
  { pattern: 'issues/[id]/triage', mod: m35 }, // lib/routes/track/issues/[id]/triage
  { pattern: 'labels/[id]', mod: m36 }, // lib/routes/track/labels/[id]
  { pattern: 'milestones/[id]', mod: m37 }, // lib/routes/track/milestones/[id]
  { pattern: 'plan-milestones/[id]', mod: m38 }, // lib/routes/track/plan-milestones/[id]
  { pattern: 'plan-updates/[id]', mod: m39 }, // lib/routes/track/plan-updates/[id]
  { pattern: 'plan-updates/[id]/comments', mod: m40 }, // lib/routes/track/plan-updates/[id]/comments
  { pattern: 'plans/[id]', mod: m41 }, // lib/routes/track/plans/[id]
  { pattern: 'plans/[id]/follow', mod: m42 }, // lib/routes/track/plans/[id]/follow
  { pattern: 'plans/[id]/issues', mod: m43 }, // lib/routes/track/plans/[id]/issues
  { pattern: 'plans/[id]/milestones', mod: m44 }, // lib/routes/track/plans/[id]/milestones
  { pattern: 'plans/[id]/updates', mod: m45 }, // lib/routes/track/plans/[id]/updates
  { pattern: 'projects/[id]', mod: m46 }, // lib/routes/track/projects/[id]
  { pattern: 'projects/[id]/ai/issue-from-text', mod: m47 }, // lib/routes/track/projects/[id]/ai/issue-from-text
  { pattern: 'projects/[id]/ai/summary', mod: m48 }, // lib/routes/track/projects/[id]/ai/summary
  { pattern: 'projects/[id]/automation', mod: m49 }, // lib/routes/track/projects/[id]/automation
  { pattern: 'projects/[id]/cycles', mod: m50 }, // lib/routes/track/projects/[id]/cycles
  { pattern: 'projects/[id]/issues', mod: m51 }, // lib/routes/track/projects/[id]/issues
  { pattern: 'projects/[id]/members', mod: m52 }, // lib/routes/track/projects/[id]/members
  { pattern: 'projects/[id]/milestones', mod: m53 }, // lib/routes/track/projects/[id]/milestones
  { pattern: 'projects/[id]/recurring', mod: m54 }, // lib/routes/track/projects/[id]/recurring
  { pattern: 'projects/[id]/statuses', mod: m55 }, // lib/routes/track/projects/[id]/statuses
  { pattern: 'projects/[id]/statuses/reorder', mod: m56 }, // lib/routes/track/projects/[id]/statuses/reorder
  { pattern: 'projects/[id]/templates', mod: m57 }, // lib/routes/track/projects/[id]/templates
  { pattern: 'projects/[id]/triage', mod: m58 }, // lib/routes/track/projects/[id]/triage
  { pattern: 'projects/[id]/triage-rules', mod: m59 }, // lib/routes/track/projects/[id]/triage-rules
  { pattern: 'projects/[id]/triage-settings', mod: m60 }, // lib/routes/track/projects/[id]/triage-settings
  { pattern: 'projects/[id]/views', mod: m61 }, // lib/routes/track/projects/[id]/views
  { pattern: 'recurring/[id]', mod: m62 }, // lib/routes/track/recurring/[id]
  { pattern: 'sentry/webhook/[id]', mod: m63 }, // lib/routes/track/sentry/webhook/[id]
  { pattern: 'statuses/[id]', mod: m64 }, // lib/routes/track/statuses/[id]
  { pattern: 'templates/[id]', mod: m65 }, // lib/routes/track/templates/[id]
  { pattern: 'triage-rules/[id]', mod: m66 }, // lib/routes/track/triage-rules/[id]
  { pattern: 'views/[id]', mod: m67 }, // lib/routes/track/views/[id]
  { pattern: 'views/[id]/default', mod: m68 }, // lib/routes/track/views/[id]/default
  { pattern: 'views/[id]/favorite', mod: m69 }, // lib/routes/track/views/[id]/favorite
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
