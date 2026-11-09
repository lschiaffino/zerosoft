// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/rec/folders/[id]/route';
import * as m1 from '@/lib/routes/rec/spaces/[id]/route';
import * as m2 from '@/lib/routes/rec/spaces/[id]/members/route';
import * as m3 from '@/lib/routes/rec/v/[share]/comments/route';
import * as m4 from '@/lib/routes/rec/v/[share]/comments/[cid]/route';
import * as m5 from '@/lib/routes/rec/v/[share]/file/route';
import * as m6 from '@/lib/routes/rec/v/[share]/identify/route';
import * as m7 from '@/lib/routes/rec/v/[share]/request/route';
import * as m8 from '@/lib/routes/rec/v/[share]/track/route';
import * as m9 from '@/lib/routes/rec/v/[share]/unlock/route';
import * as m10 from '@/lib/routes/rec/videos/[id]/route';
import * as m11 from '@/lib/routes/rec/videos/[id]/analytics/route';
import * as m12 from '@/lib/routes/rec/videos/[id]/asset/route';
import * as m13 from '@/lib/routes/rec/videos/[id]/complete/route';
import * as m14 from '@/lib/routes/rec/videos/[id]/derive/route';
import * as m15 from '@/lib/routes/rec/videos/[id]/export/route';
import * as m16 from '@/lib/routes/rec/videos/[id]/file/route';
import * as m17 from '@/lib/routes/rec/videos/[id]/later/route';
import * as m18 from '@/lib/routes/rec/videos/[id]/parts/route';
import * as m19 from '@/lib/routes/rec/videos/[id]/recap/route';
import * as m20 from '@/lib/routes/rec/videos/[id]/requests/route';
import * as m21 from '@/lib/routes/rec/videos/[id]/requests/[rid]/route';
import * as m22 from '@/lib/routes/rec/videos/[id]/rotate-share/route';
import * as m23 from '@/lib/routes/rec/videos/[id]/upload-token/route';
import * as m24 from '@/lib/routes/rec/v/[share]/access/route';
import * as m25 from '@/lib/routes/rec/v/[share]/invite/route';
import * as m26 from '@/lib/routes/rec/videos/[id]/people/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'folders/[id]', mod: m0 }, // lib/routes/rec/folders/[id]
  { pattern: 'spaces/[id]', mod: m1 }, // lib/routes/rec/spaces/[id]
  { pattern: 'spaces/[id]/members', mod: m2 }, // lib/routes/rec/spaces/[id]/members
  { pattern: 'v/[share]/comments', mod: m3 }, // lib/routes/rec/v/[share]/comments
  { pattern: 'v/[share]/comments/[cid]', mod: m4 }, // lib/routes/rec/v/[share]/comments/[cid]
  { pattern: 'v/[share]/file', mod: m5 }, // lib/routes/rec/v/[share]/file
  { pattern: 'v/[share]/identify', mod: m6 }, // lib/routes/rec/v/[share]/identify
  { pattern: 'v/[share]/request', mod: m7 }, // lib/routes/rec/v/[share]/request
  { pattern: 'v/[share]/track', mod: m8 }, // lib/routes/rec/v/[share]/track
  { pattern: 'v/[share]/unlock', mod: m9 }, // lib/routes/rec/v/[share]/unlock
  { pattern: 'videos/[id]', mod: m10 }, // lib/routes/rec/videos/[id]
  { pattern: 'videos/[id]/analytics', mod: m11 }, // lib/routes/rec/videos/[id]/analytics
  { pattern: 'videos/[id]/asset', mod: m12 }, // lib/routes/rec/videos/[id]/asset
  { pattern: 'videos/[id]/complete', mod: m13 }, // lib/routes/rec/videos/[id]/complete
  { pattern: 'videos/[id]/derive', mod: m14 }, // lib/routes/rec/videos/[id]/derive
  { pattern: 'videos/[id]/export', mod: m15 }, // lib/routes/rec/videos/[id]/export
  { pattern: 'videos/[id]/file', mod: m16 }, // lib/routes/rec/videos/[id]/file
  { pattern: 'videos/[id]/later', mod: m17 }, // lib/routes/rec/videos/[id]/later
  { pattern: 'videos/[id]/parts', mod: m18 }, // lib/routes/rec/videos/[id]/parts
  { pattern: 'videos/[id]/recap', mod: m19 }, // lib/routes/rec/videos/[id]/recap
  { pattern: 'videos/[id]/requests', mod: m20 }, // lib/routes/rec/videos/[id]/requests
  { pattern: 'videos/[id]/requests/[rid]', mod: m21 }, // lib/routes/rec/videos/[id]/requests/[rid]
  { pattern: 'videos/[id]/rotate-share', mod: m22 }, // lib/routes/rec/videos/[id]/rotate-share
  { pattern: 'videos/[id]/upload-token', mod: m23 }, // lib/routes/rec/videos/[id]/upload-token
  { pattern: 'v/[share]/access', mod: m24 }, // lib/routes/rec/v/[share]/access
  { pattern: 'v/[share]/invite', mod: m25 }, // lib/routes/rec/v/[share]/invite
  { pattern: 'videos/[id]/people', mod: m26 }, // lib/routes/rec/videos/[id]/people
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
