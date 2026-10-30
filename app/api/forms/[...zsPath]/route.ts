// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/forms/[id]/route';
import * as m1 from '@/lib/routes/forms/[id]/duplicate/route';
import * as m2 from '@/lib/routes/forms/[id]/export/route';
import * as m3 from '@/lib/routes/forms/[id]/responses/route';
import * as m4 from '@/lib/routes/forms/[id]/responses/[rid]/route';
import * as m5 from '@/lib/routes/forms/[id]/summary/route';
import * as m6 from '@/lib/routes/forms/files/[fileId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: '[id]', mod: m0 }, // lib/routes/forms/[id]
  { pattern: '[id]/duplicate', mod: m1 }, // lib/routes/forms/[id]/duplicate
  { pattern: '[id]/export', mod: m2 }, // lib/routes/forms/[id]/export
  { pattern: '[id]/responses', mod: m3 }, // lib/routes/forms/[id]/responses
  { pattern: '[id]/responses/[rid]', mod: m4 }, // lib/routes/forms/[id]/responses/[rid]
  { pattern: '[id]/summary', mod: m5 }, // lib/routes/forms/[id]/summary
  { pattern: 'files/[fileId]', mod: m6 }, // lib/routes/forms/files/[fileId]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
