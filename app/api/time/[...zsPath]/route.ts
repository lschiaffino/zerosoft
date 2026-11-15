// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/time/clients/[id]/route';
import * as m1 from '@/lib/routes/time/entries/[id]/route';
import * as m2 from '@/lib/routes/time/projects/[id]/route';
import * as m3 from '@/lib/routes/time/tasks/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'clients/[id]', mod: m0 }, // lib/routes/time/clients/[id]
  { pattern: 'entries/[id]', mod: m1 }, // lib/routes/time/entries/[id]
  { pattern: 'projects/[id]', mod: m2 }, // lib/routes/time/projects/[id]
  { pattern: 'tasks/[id]', mod: m3 }, // lib/routes/time/tasks/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
