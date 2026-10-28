// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/flow/credentials/[id]/route';
import * as m1 from '@/lib/routes/flow/flows/[id]/route';
import * as m2 from '@/lib/routes/flow/flows/[id]/held/route';
import * as m3 from '@/lib/routes/flow/flows/[id]/pins/route';
import * as m4 from '@/lib/routes/flow/flows/[id]/runs/route';
import * as m5 from '@/lib/routes/flow/flows/[id]/versions/route';
import * as m6 from '@/lib/routes/flow/flows/[id]/versions/[versionId]/route';
import * as m7 from '@/lib/routes/flow/folders/[id]/route';
import * as m8 from '@/lib/routes/flow/runs/[id]/route';
import * as m9 from '@/lib/routes/flow/runs/[id]/cancel/route';
import * as m10 from '@/lib/routes/flow/tables/[id]/route';
import * as m11 from '@/lib/routes/flow/tables/[id]/rows/route';
import * as m12 from '@/lib/routes/flow/tables/[id]/rows/[rowId]/route';
import * as m13 from '@/lib/routes/flow/variables/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'credentials/[id]', mod: m0 }, // lib/routes/flow/credentials/[id]
  { pattern: 'flows/[id]', mod: m1 }, // lib/routes/flow/flows/[id]
  { pattern: 'flows/[id]/held', mod: m2 }, // lib/routes/flow/flows/[id]/held
  { pattern: 'flows/[id]/pins', mod: m3 }, // lib/routes/flow/flows/[id]/pins
  { pattern: 'flows/[id]/runs', mod: m4 }, // lib/routes/flow/flows/[id]/runs
  { pattern: 'flows/[id]/versions', mod: m5 }, // lib/routes/flow/flows/[id]/versions
  { pattern: 'flows/[id]/versions/[versionId]', mod: m6 }, // lib/routes/flow/flows/[id]/versions/[versionId]
  { pattern: 'folders/[id]', mod: m7 }, // lib/routes/flow/folders/[id]
  { pattern: 'runs/[id]', mod: m8 }, // lib/routes/flow/runs/[id]
  { pattern: 'runs/[id]/cancel', mod: m9 }, // lib/routes/flow/runs/[id]/cancel
  { pattern: 'tables/[id]', mod: m10 }, // lib/routes/flow/tables/[id]
  { pattern: 'tables/[id]/rows', mod: m11 }, // lib/routes/flow/tables/[id]/rows
  { pattern: 'tables/[id]/rows/[rowId]', mod: m12 }, // lib/routes/flow/tables/[id]/rows/[rowId]
  { pattern: 'variables/[id]', mod: m13 }, // lib/routes/flow/variables/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
