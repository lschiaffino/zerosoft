// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/analytics/actions/[id]/route';
import * as m1 from '@/lib/routes/analytics/alerts/[id]/route';
import * as m2 from '@/lib/routes/analytics/annotations/[id]/route';
import * as m3 from '@/lib/routes/analytics/cohorts/[id]/route';
import * as m4 from '@/lib/routes/analytics/cohorts/[id]/members/route';
import * as m5 from '@/lib/routes/analytics/dashboards/[id]/route';
import * as m6 from '@/lib/routes/analytics/errors/[ref]/route';
import * as m7 from '@/lib/routes/analytics/experiments/[id]/route';
import * as m8 from '@/lib/routes/analytics/flags/[id]/route';
import * as m9 from '@/lib/routes/analytics/insights/[id]/route';
import * as m10 from '@/lib/routes/analytics/persons/[id]/route';
import * as m11 from '@/lib/routes/analytics/projects/[id]/route';
import * as m12 from '@/lib/routes/analytics/projects/[id]/secret/route';
import * as m13 from '@/lib/routes/analytics/replay/[id]/route';
import * as m14 from '@/lib/routes/analytics/replay/[id]/chunks/route';
import * as m15 from '@/lib/routes/analytics/shares/[id]/route';
import * as m16 from '@/lib/routes/analytics/subscriptions/[id]/route';
import * as m17 from '@/lib/routes/analytics/surveys/[id]/route';
import * as m18 from '@/lib/routes/analytics/surveys/[id]/export/route';
import * as m19 from '@/lib/routes/analytics/surveys/[id]/results/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'actions/[id]', mod: m0 }, // lib/routes/analytics/actions/[id]
  { pattern: 'alerts/[id]', mod: m1 }, // lib/routes/analytics/alerts/[id]
  { pattern: 'annotations/[id]', mod: m2 }, // lib/routes/analytics/annotations/[id]
  { pattern: 'cohorts/[id]', mod: m3 }, // lib/routes/analytics/cohorts/[id]
  { pattern: 'cohorts/[id]/members', mod: m4 }, // lib/routes/analytics/cohorts/[id]/members
  { pattern: 'dashboards/[id]', mod: m5 }, // lib/routes/analytics/dashboards/[id]
  { pattern: 'errors/[ref]', mod: m6 }, // lib/routes/analytics/errors/[ref]
  { pattern: 'experiments/[id]', mod: m7 }, // lib/routes/analytics/experiments/[id]
  { pattern: 'flags/[id]', mod: m8 }, // lib/routes/analytics/flags/[id]
  { pattern: 'insights/[id]', mod: m9 }, // lib/routes/analytics/insights/[id]
  { pattern: 'persons/[id]', mod: m10 }, // lib/routes/analytics/persons/[id]
  { pattern: 'projects/[id]', mod: m11 }, // lib/routes/analytics/projects/[id]
  { pattern: 'projects/[id]/secret', mod: m12 }, // lib/routes/analytics/projects/[id]/secret
  { pattern: 'replay/[id]', mod: m13 }, // lib/routes/analytics/replay/[id]
  { pattern: 'replay/[id]/chunks', mod: m14 }, // lib/routes/analytics/replay/[id]/chunks
  { pattern: 'shares/[id]', mod: m15 }, // lib/routes/analytics/shares/[id]
  { pattern: 'subscriptions/[id]', mod: m16 }, // lib/routes/analytics/subscriptions/[id]
  { pattern: 'surveys/[id]', mod: m17 }, // lib/routes/analytics/surveys/[id]
  { pattern: 'surveys/[id]/export', mod: m18 }, // lib/routes/analytics/surveys/[id]/export
  { pattern: 'surveys/[id]/results', mod: m19 }, // lib/routes/analytics/surveys/[id]/results
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
