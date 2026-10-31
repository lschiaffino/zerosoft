// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/robots/[id]/route';
import * as m1 from '@/lib/routes/robots/[id]/bulk/route';
import * as m2 from '@/lib/routes/robots/[id]/export/route';
import * as m3 from '@/lib/routes/robots/[id]/recording/route';
import * as m4 from '@/lib/routes/robots/[id]/rows/route';
import * as m5 from '@/lib/routes/robots/[id]/runs/route';
import * as m6 from '@/lib/routes/robots/[id]/session/route';
import * as m7 from '@/lib/routes/robots/batches/[id]/route';
import * as m8 from '@/lib/routes/robots/recordings/[id]/route';
import * as m9 from '@/lib/routes/robots/recordings/[id]/steps/route';
import * as m10 from '@/lib/routes/robots/runs/[id]/route';
import * as m11 from '@/lib/routes/robots/runs/[id]/fix/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: '[id]', mod: m0 }, // lib/routes/robots/[id]
  { pattern: '[id]/bulk', mod: m1 }, // lib/routes/robots/[id]/bulk
  { pattern: '[id]/export', mod: m2 }, // lib/routes/robots/[id]/export
  { pattern: '[id]/recording', mod: m3 }, // lib/routes/robots/[id]/recording
  { pattern: '[id]/rows', mod: m4 }, // lib/routes/robots/[id]/rows
  { pattern: '[id]/runs', mod: m5 }, // lib/routes/robots/[id]/runs
  { pattern: '[id]/session', mod: m6 }, // lib/routes/robots/[id]/session
  { pattern: 'batches/[id]', mod: m7 }, // lib/routes/robots/batches/[id]
  { pattern: 'recordings/[id]', mod: m8 }, // lib/routes/robots/recordings/[id]
  { pattern: 'recordings/[id]/steps', mod: m9 }, // lib/routes/robots/recordings/[id]/steps
  { pattern: 'runs/[id]', mod: m10 }, // lib/routes/robots/runs/[id]
  { pattern: 'runs/[id]/fix', mod: m11 }, // lib/routes/robots/runs/[id]/fix
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
