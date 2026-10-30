// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/analytics/cohorts/[id]/route';
import * as m1 from '@/lib/routes/analytics/dashboards/[id]/route';
import * as m2 from '@/lib/routes/analytics/flags/[id]/route';
import * as m3 from '@/lib/routes/analytics/insights/[id]/route';
import * as m4 from '@/lib/routes/analytics/persons/[id]/route';
import * as m5 from '@/lib/routes/analytics/projects/[id]/route';
import * as m6 from '@/lib/routes/analytics/projects/[id]/secret/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'cohorts/[id]', mod: m0 }, // lib/routes/analytics/cohorts/[id]
  { pattern: 'dashboards/[id]', mod: m1 }, // lib/routes/analytics/dashboards/[id]
  { pattern: 'flags/[id]', mod: m2 }, // lib/routes/analytics/flags/[id]
  { pattern: 'insights/[id]', mod: m3 }, // lib/routes/analytics/insights/[id]
  { pattern: 'persons/[id]', mod: m4 }, // lib/routes/analytics/persons/[id]
  { pattern: 'projects/[id]', mod: m5 }, // lib/routes/analytics/projects/[id]
  { pattern: 'projects/[id]/secret', mod: m6 }, // lib/routes/analytics/projects/[id]/secret
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
