// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/rec/folders/[id]/route';
import * as m1 from '@/lib/routes/rec/v/[share]/comments/route';
import * as m2 from '@/lib/routes/rec/v/[share]/comments/[cid]/route';
import * as m3 from '@/lib/routes/rec/v/[share]/file/route';
import * as m4 from '@/lib/routes/rec/v/[share]/track/route';
import * as m5 from '@/lib/routes/rec/v/[share]/unlock/route';
import * as m6 from '@/lib/routes/rec/videos/[id]/route';
import * as m7 from '@/lib/routes/rec/videos/[id]/analytics/route';
import * as m8 from '@/lib/routes/rec/videos/[id]/asset/route';
import * as m9 from '@/lib/routes/rec/videos/[id]/complete/route';
import * as m10 from '@/lib/routes/rec/videos/[id]/file/route';
import * as m11 from '@/lib/routes/rec/videos/[id]/parts/route';
import * as m12 from '@/lib/routes/rec/videos/[id]/upload-token/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'folders/[id]', mod: m0 }, // lib/routes/rec/folders/[id]
  { pattern: 'v/[share]/comments', mod: m1 }, // lib/routes/rec/v/[share]/comments
  { pattern: 'v/[share]/comments/[cid]', mod: m2 }, // lib/routes/rec/v/[share]/comments/[cid]
  { pattern: 'v/[share]/file', mod: m3 }, // lib/routes/rec/v/[share]/file
  { pattern: 'v/[share]/track', mod: m4 }, // lib/routes/rec/v/[share]/track
  { pattern: 'v/[share]/unlock', mod: m5 }, // lib/routes/rec/v/[share]/unlock
  { pattern: 'videos/[id]', mod: m6 }, // lib/routes/rec/videos/[id]
  { pattern: 'videos/[id]/analytics', mod: m7 }, // lib/routes/rec/videos/[id]/analytics
  { pattern: 'videos/[id]/asset', mod: m8 }, // lib/routes/rec/videos/[id]/asset
  { pattern: 'videos/[id]/complete', mod: m9 }, // lib/routes/rec/videos/[id]/complete
  { pattern: 'videos/[id]/file', mod: m10 }, // lib/routes/rec/videos/[id]/file
  { pattern: 'videos/[id]/parts', mod: m11 }, // lib/routes/rec/videos/[id]/parts
  { pattern: 'videos/[id]/upload-token', mod: m12 }, // lib/routes/rec/videos/[id]/upload-token
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
