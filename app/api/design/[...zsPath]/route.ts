// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/design/designs/[id]/route';
import * as m1 from '@/lib/routes/design/designs/[id]/comments/route';
import * as m2 from '@/lib/routes/design/designs/[id]/comments/[cid]/route';
import * as m3 from '@/lib/routes/design/designs/[id]/duplicate/route';
import * as m4 from '@/lib/routes/design/designs/[id]/presence/route';
import * as m5 from '@/lib/routes/design/designs/[id]/share/route';
import * as m6 from '@/lib/routes/design/designs/[id]/template/route';
import * as m7 from '@/lib/routes/design/files/[id]/route';
import * as m8 from '@/lib/routes/design/folders/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'designs/[id]', mod: m0 }, // lib/routes/design/designs/[id]
  { pattern: 'designs/[id]/comments', mod: m1 }, // lib/routes/design/designs/[id]/comments
  { pattern: 'designs/[id]/comments/[cid]', mod: m2 }, // lib/routes/design/designs/[id]/comments/[cid]
  { pattern: 'designs/[id]/duplicate', mod: m3 }, // lib/routes/design/designs/[id]/duplicate
  { pattern: 'designs/[id]/presence', mod: m4 }, // lib/routes/design/designs/[id]/presence
  { pattern: 'designs/[id]/share', mod: m5 }, // lib/routes/design/designs/[id]/share
  { pattern: 'designs/[id]/template', mod: m6 }, // lib/routes/design/designs/[id]/template
  { pattern: 'files/[id]', mod: m7 }, // lib/routes/design/files/[id]
  { pattern: 'folders/[id]', mod: m8 }, // lib/routes/design/folders/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
