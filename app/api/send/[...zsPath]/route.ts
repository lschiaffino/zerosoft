// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/send/documents/[id]/route';
import * as m1 from '@/lib/routes/send/documents/[id]/analytics/route';
import * as m2 from '@/lib/routes/send/documents/[id]/export/route';
import * as m3 from '@/lib/routes/send/documents/[id]/links/route';
import * as m4 from '@/lib/routes/send/documents/[id]/live/route';
import * as m5 from '@/lib/routes/send/documents/[id]/versions/route';
import * as m6 from '@/lib/routes/send/links/[id]/route';
import * as m7 from '@/lib/routes/send/public/[token]/route';
import * as m8 from '@/lib/routes/send/public/[token]/click/route';
import * as m9 from '@/lib/routes/send/public/[token]/code/route';
import * as m10 from '@/lib/routes/send/public/[token]/download/route';
import * as m11 from '@/lib/routes/send/public/[token]/nda/route';
import * as m12 from '@/lib/routes/send/public/[token]/pages/[version]/[page]/route';
import * as m13 from '@/lib/routes/send/public/[token]/ping/route';
import * as m14 from '@/lib/routes/send/public/[token]/video/[version]/route';
import * as m15 from '@/lib/routes/send/spaces/[id]/route';
import * as m16 from '@/lib/routes/send/spaces/[id]/access/route';
import * as m17 from '@/lib/routes/send/spaces/[id]/analytics/route';
import * as m18 from '@/lib/routes/send/spaces/[id]/links/route';
import * as m19 from '@/lib/routes/send/versions/[id]/complete/route';
import * as m20 from '@/lib/routes/send/versions/[id]/file/route';
import * as m21 from '@/lib/routes/send/versions/[id]/pages/[page]/route';
import * as m22 from '@/lib/routes/send/versions/[id]/parts/[n]/route';
import * as m23 from '@/lib/routes/send/versions/[id]/process/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'documents/[id]', mod: m0 }, // lib/routes/send/documents/[id]
  { pattern: 'documents/[id]/analytics', mod: m1 }, // lib/routes/send/documents/[id]/analytics
  { pattern: 'documents/[id]/export', mod: m2 }, // lib/routes/send/documents/[id]/export
  { pattern: 'documents/[id]/links', mod: m3 }, // lib/routes/send/documents/[id]/links
  { pattern: 'documents/[id]/live', mod: m4 }, // lib/routes/send/documents/[id]/live
  { pattern: 'documents/[id]/versions', mod: m5 }, // lib/routes/send/documents/[id]/versions
  { pattern: 'links/[id]', mod: m6 }, // lib/routes/send/links/[id]
  { pattern: 'public/[token]', mod: m7 }, // lib/routes/send/public/[token]
  { pattern: 'public/[token]/click', mod: m8 }, // lib/routes/send/public/[token]/click
  { pattern: 'public/[token]/code', mod: m9 }, // lib/routes/send/public/[token]/code
  { pattern: 'public/[token]/download', mod: m10 }, // lib/routes/send/public/[token]/download
  { pattern: 'public/[token]/nda', mod: m11 }, // lib/routes/send/public/[token]/nda
  { pattern: 'public/[token]/pages/[version]/[page]', mod: m12 }, // lib/routes/send/public/[token]/pages/[version]/[page]
  { pattern: 'public/[token]/ping', mod: m13 }, // lib/routes/send/public/[token]/ping
  { pattern: 'public/[token]/video/[version]', mod: m14 }, // lib/routes/send/public/[token]/video/[version]
  { pattern: 'spaces/[id]', mod: m15 }, // lib/routes/send/spaces/[id]
  { pattern: 'spaces/[id]/access', mod: m16 }, // lib/routes/send/spaces/[id]/access
  { pattern: 'spaces/[id]/analytics', mod: m17 }, // lib/routes/send/spaces/[id]/analytics
  { pattern: 'spaces/[id]/links', mod: m18 }, // lib/routes/send/spaces/[id]/links
  { pattern: 'versions/[id]/complete', mod: m19 }, // lib/routes/send/versions/[id]/complete
  { pattern: 'versions/[id]/file', mod: m20 }, // lib/routes/send/versions/[id]/file
  { pattern: 'versions/[id]/pages/[page]', mod: m21 }, // lib/routes/send/versions/[id]/pages/[page]
  { pattern: 'versions/[id]/parts/[n]', mod: m22 }, // lib/routes/send/versions/[id]/parts/[n]
  { pattern: 'versions/[id]/process', mod: m23 }, // lib/routes/send/versions/[id]/process
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
