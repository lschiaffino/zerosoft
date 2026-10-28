// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/docs/databases/[pageId]/[blockId]/route';
import * as m1 from '@/lib/routes/docs/databases/[pageId]/[blockId]/runs/route';
import * as m2 from '@/lib/routes/docs/files/[pageId]/[blockId]/route';
import * as m3 from '@/lib/routes/docs/meetings/[id]/route';
import * as m4 from '@/lib/routes/docs/meetings/[id]/tasks/route';
import * as m5 from '@/lib/routes/docs/pages/[id]/route';
import * as m6 from '@/lib/routes/docs/pages/[id]/comments/route';
import * as m7 from '@/lib/routes/docs/pages/[id]/comments/[commentId]/route';
import * as m8 from '@/lib/routes/docs/pages/[id]/duplicate/route';
import * as m9 from '@/lib/routes/docs/pages/[id]/export/route';
import * as m10 from '@/lib/routes/docs/pages/[id]/files/route';
import * as m11 from '@/lib/routes/docs/pages/[id]/files/blob/route';
import * as m12 from '@/lib/routes/docs/pages/[id]/import/route';
import * as m13 from '@/lib/routes/docs/pages/[id]/live/route';
import * as m14 from '@/lib/routes/docs/pages/[id]/mentions/route';
import * as m15 from '@/lib/routes/docs/pages/[id]/share/route';
import * as m16 from '@/lib/routes/docs/pages/[id]/share/[shareId]/route';
import * as m17 from '@/lib/routes/docs/pages/[id]/site/route';
import * as m18 from '@/lib/routes/docs/pages/[id]/verify/route';
import * as m19 from '@/lib/routes/docs/pages/[id]/versions/route';
import * as m20 from '@/lib/routes/docs/pages/[id]/versions/[versionId]/route';
import * as m21 from '@/lib/routes/docs/pages/[id]/versions/[versionId]/restore/route';
import * as m22 from '@/lib/routes/docs/pages/[id]/views/route';
import * as m23 from '@/lib/routes/docs/synced/[id]/route';
import * as m24 from '@/lib/routes/docs/teamspaces/[id]/route';
import * as m25 from '@/lib/routes/docs/teamspaces/[id]/members/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'databases/[pageId]/[blockId]', mod: m0 }, // lib/routes/docs/databases/[pageId]/[blockId]
  { pattern: 'databases/[pageId]/[blockId]/runs', mod: m1 }, // lib/routes/docs/databases/[pageId]/[blockId]/runs
  { pattern: 'files/[pageId]/[blockId]', mod: m2 }, // lib/routes/docs/files/[pageId]/[blockId]
  { pattern: 'meetings/[id]', mod: m3 }, // lib/routes/docs/meetings/[id]
  { pattern: 'meetings/[id]/tasks', mod: m4 }, // lib/routes/docs/meetings/[id]/tasks
  { pattern: 'pages/[id]', mod: m5 }, // lib/routes/docs/pages/[id]
  { pattern: 'pages/[id]/comments', mod: m6 }, // lib/routes/docs/pages/[id]/comments
  { pattern: 'pages/[id]/comments/[commentId]', mod: m7 }, // lib/routes/docs/pages/[id]/comments/[commentId]
  { pattern: 'pages/[id]/duplicate', mod: m8 }, // lib/routes/docs/pages/[id]/duplicate
  { pattern: 'pages/[id]/export', mod: m9 }, // lib/routes/docs/pages/[id]/export
  { pattern: 'pages/[id]/files', mod: m10 }, // lib/routes/docs/pages/[id]/files
  { pattern: 'pages/[id]/files/blob', mod: m11 }, // lib/routes/docs/pages/[id]/files/blob
  { pattern: 'pages/[id]/import', mod: m12 }, // lib/routes/docs/pages/[id]/import
  { pattern: 'pages/[id]/live', mod: m13 }, // lib/routes/docs/pages/[id]/live
  { pattern: 'pages/[id]/mentions', mod: m14 }, // lib/routes/docs/pages/[id]/mentions
  { pattern: 'pages/[id]/share', mod: m15 }, // lib/routes/docs/pages/[id]/share
  { pattern: 'pages/[id]/share/[shareId]', mod: m16 }, // lib/routes/docs/pages/[id]/share/[shareId]
  { pattern: 'pages/[id]/site', mod: m17 }, // lib/routes/docs/pages/[id]/site
  { pattern: 'pages/[id]/verify', mod: m18 }, // lib/routes/docs/pages/[id]/verify
  { pattern: 'pages/[id]/versions', mod: m19 }, // lib/routes/docs/pages/[id]/versions
  { pattern: 'pages/[id]/versions/[versionId]', mod: m20 }, // lib/routes/docs/pages/[id]/versions/[versionId]
  { pattern: 'pages/[id]/versions/[versionId]/restore', mod: m21 }, // lib/routes/docs/pages/[id]/versions/[versionId]/restore
  { pattern: 'pages/[id]/views', mod: m22 }, // lib/routes/docs/pages/[id]/views
  { pattern: 'synced/[id]', mod: m23 }, // lib/routes/docs/synced/[id]
  { pattern: 'teamspaces/[id]', mod: m24 }, // lib/routes/docs/teamspaces/[id]
  { pattern: 'teamspaces/[id]/members', mod: m25 }, // lib/routes/docs/teamspaces/[id]/members
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
