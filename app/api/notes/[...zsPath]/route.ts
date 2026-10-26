// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/notes/[id]/route';
import * as m1 from '@/lib/routes/notes/[id]/export/route';
import * as m2 from '@/lib/routes/notes/[id]/files/route';
import * as m3 from '@/lib/routes/notes/[id]/files/[blockId]/route';
import * as m4 from '@/lib/routes/notes/[id]/reminder/route';
import * as m5 from '@/lib/routes/notes/[id]/share/route';
import * as m6 from '@/lib/routes/notes/[id]/shares/route';
import * as m7 from '@/lib/routes/notes/[id]/track/route';
import * as m8 from '@/lib/routes/notes/[id]/versions/route';
import * as m9 from '@/lib/routes/notes/[id]/versions/[versionId]/route';
import * as m10 from '@/lib/routes/notes/[id]/versions/[versionId]/restore/route';
import * as m11 from '@/lib/routes/notes/notebooks/[id]/route';
import * as m12 from '@/lib/routes/notes/notebooks/[id]/shares/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: '[id]', mod: m0 }, // lib/routes/notes/[id]
  { pattern: '[id]/export', mod: m1 }, // lib/routes/notes/[id]/export
  { pattern: '[id]/files', mod: m2 }, // lib/routes/notes/[id]/files
  { pattern: '[id]/files/[blockId]', mod: m3 }, // lib/routes/notes/[id]/files/[blockId]
  { pattern: '[id]/reminder', mod: m4 }, // lib/routes/notes/[id]/reminder
  { pattern: '[id]/share', mod: m5 }, // lib/routes/notes/[id]/share
  { pattern: '[id]/shares', mod: m6 }, // lib/routes/notes/[id]/shares
  { pattern: '[id]/track', mod: m7 }, // lib/routes/notes/[id]/track
  { pattern: '[id]/versions', mod: m8 }, // lib/routes/notes/[id]/versions
  { pattern: '[id]/versions/[versionId]', mod: m9 }, // lib/routes/notes/[id]/versions/[versionId]
  { pattern: '[id]/versions/[versionId]/restore', mod: m10 }, // lib/routes/notes/[id]/versions/[versionId]/restore
  { pattern: 'notebooks/[id]', mod: m11 }, // lib/routes/notes/notebooks/[id]
  { pattern: 'notebooks/[id]/shares', mod: m12 }, // lib/routes/notes/notebooks/[id]/shares
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
