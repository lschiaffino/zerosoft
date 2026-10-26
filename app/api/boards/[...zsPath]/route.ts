// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/boards/[id]/route';
import * as m1 from '@/lib/routes/boards/[id]/access/route';
import * as m2 from '@/lib/routes/boards/[id]/comments/route';
import * as m3 from '@/lib/routes/boards/[id]/comments/[threadId]/route';
import * as m4 from '@/lib/routes/boards/[id]/comments/[threadId]/[commentId]/route';
import * as m5 from '@/lib/routes/boards/[id]/duplicate/route';
import * as m6 from '@/lib/routes/boards/[id]/embed/route';
import * as m7 from '@/lib/routes/boards/[id]/files/route';
import * as m8 from '@/lib/routes/boards/[id]/files/[fileId]/route';
import * as m9 from '@/lib/routes/boards/[id]/history/route';
import * as m10 from '@/lib/routes/boards/[id]/history/[snapshotId]/route';
import * as m11 from '@/lib/routes/boards/[id]/scene/route';
import * as m12 from '@/lib/routes/boards/[id]/share/route';
import * as m13 from '@/lib/routes/boards/[id]/track/route';
import * as m14 from '@/lib/routes/boards/[id]/version/route';
import * as m15 from '@/lib/routes/boards/[id]/workshop/route';
import * as m16 from '@/lib/routes/boards/guest/[token]/route';
import * as m17 from '@/lib/routes/boards/guest/[token]/files/route';
import * as m18 from '@/lib/routes/boards/guest/[token]/scene/route';
import * as m19 from '@/lib/routes/boards/guest/[token]/version/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: '[id]', mod: m0 }, // lib/routes/boards/[id]
  { pattern: '[id]/access', mod: m1 }, // lib/routes/boards/[id]/access
  { pattern: '[id]/comments', mod: m2 }, // lib/routes/boards/[id]/comments
  { pattern: '[id]/comments/[threadId]', mod: m3 }, // lib/routes/boards/[id]/comments/[threadId]
  { pattern: '[id]/comments/[threadId]/[commentId]', mod: m4 }, // lib/routes/boards/[id]/comments/[threadId]/[commentId]
  { pattern: '[id]/duplicate', mod: m5 }, // lib/routes/boards/[id]/duplicate
  { pattern: '[id]/embed', mod: m6 }, // lib/routes/boards/[id]/embed
  { pattern: '[id]/files', mod: m7 }, // lib/routes/boards/[id]/files
  { pattern: '[id]/files/[fileId]', mod: m8 }, // lib/routes/boards/[id]/files/[fileId]
  { pattern: '[id]/history', mod: m9 }, // lib/routes/boards/[id]/history
  { pattern: '[id]/history/[snapshotId]', mod: m10 }, // lib/routes/boards/[id]/history/[snapshotId]
  { pattern: '[id]/scene', mod: m11 }, // lib/routes/boards/[id]/scene
  { pattern: '[id]/share', mod: m12 }, // lib/routes/boards/[id]/share
  { pattern: '[id]/track', mod: m13 }, // lib/routes/boards/[id]/track
  { pattern: '[id]/version', mod: m14 }, // lib/routes/boards/[id]/version
  { pattern: '[id]/workshop', mod: m15 }, // lib/routes/boards/[id]/workshop
  { pattern: 'guest/[token]', mod: m16 }, // lib/routes/boards/guest/[token]
  { pattern: 'guest/[token]/files', mod: m17 }, // lib/routes/boards/guest/[token]/files
  { pattern: 'guest/[token]/scene', mod: m18 }, // lib/routes/boards/guest/[token]/scene
  { pattern: 'guest/[token]/version', mod: m19 }, // lib/routes/boards/guest/[token]/version
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
