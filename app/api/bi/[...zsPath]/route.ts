// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/bi/collections/[id]/route';
import * as m1 from '@/lib/routes/bi/dashboards/[id]/route';
import * as m2 from '@/lib/routes/bi/dashboards/[id]/cards/route';
import * as m3 from '@/lib/routes/bi/dashboards/[id]/subscriptions/route';
import * as m4 from '@/lib/routes/bi/databases/[id]/route';
import * as m5 from '@/lib/routes/bi/databases/[id]/sync/route';
import * as m6 from '@/lib/routes/bi/questions/[id]/route';
import * as m7 from '@/lib/routes/bi/questions/[id]/run/route';
import * as m8 from '@/lib/routes/bi/shares/[id]/route';
import * as m9 from '@/lib/routes/bi/subscriptions/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'collections/[id]', mod: m0 }, // lib/routes/bi/collections/[id]
  { pattern: 'dashboards/[id]', mod: m1 }, // lib/routes/bi/dashboards/[id]
  { pattern: 'dashboards/[id]/cards', mod: m2 }, // lib/routes/bi/dashboards/[id]/cards
  { pattern: 'dashboards/[id]/subscriptions', mod: m3 }, // lib/routes/bi/dashboards/[id]/subscriptions
  { pattern: 'databases/[id]', mod: m4 }, // lib/routes/bi/databases/[id]
  { pattern: 'databases/[id]/sync', mod: m5 }, // lib/routes/bi/databases/[id]/sync
  { pattern: 'questions/[id]', mod: m6 }, // lib/routes/bi/questions/[id]
  { pattern: 'questions/[id]/run', mod: m7 }, // lib/routes/bi/questions/[id]/run
  { pattern: 'shares/[id]', mod: m8 }, // lib/routes/bi/shares/[id]
  { pattern: 'subscriptions/[id]', mod: m9 }, // lib/routes/bi/subscriptions/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
