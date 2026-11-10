// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/calls/bot/jobs/[id]/complete/route';
import * as m1 from '@/lib/routes/calls/bot/jobs/[id]/events/route';
import * as m2 from '@/lib/routes/calls/bot/jobs/[id]/parts/[kind]/[n]/route';
import * as m3 from '@/lib/routes/calls/calls/[id]/route';
import * as m4 from '@/lib/routes/calls/calls/[id]/ask/route';
import * as m5 from '@/lib/routes/calls/calls/[id]/clips/route';
import * as m6 from '@/lib/routes/calls/calls/[id]/clips/[clipId]/route';
import * as m7 from '@/lib/routes/calls/calls/[id]/comments/route';
import * as m8 from '@/lib/routes/calls/calls/[id]/comments/[commentId]/route';
import * as m9 from '@/lib/routes/calls/calls/[id]/complete/route';
import * as m10 from '@/lib/routes/calls/calls/[id]/export/route';
import * as m11 from '@/lib/routes/calls/calls/[id]/media/route';
import * as m12 from '@/lib/routes/calls/calls/[id]/parts/[n]/route';
import * as m13 from '@/lib/routes/calls/calls/[id]/reanalyze/route';
import * as m14 from '@/lib/routes/calls/calls/[id]/share/route';
import * as m15 from '@/lib/routes/calls/calls/[id]/stop/route';
import * as m16 from '@/lib/routes/calls/public/[token]/route';
import * as m17 from '@/lib/routes/calls/public/[token]/media/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'bot/jobs/[id]/complete', mod: m0 }, // lib/routes/calls/bot/jobs/[id]/complete
  { pattern: 'bot/jobs/[id]/events', mod: m1 }, // lib/routes/calls/bot/jobs/[id]/events
  { pattern: 'bot/jobs/[id]/parts/[kind]/[n]', mod: m2 }, // lib/routes/calls/bot/jobs/[id]/parts/[kind]/[n]
  { pattern: 'calls/[id]', mod: m3 }, // lib/routes/calls/calls/[id]
  { pattern: 'calls/[id]/ask', mod: m4 }, // lib/routes/calls/calls/[id]/ask
  { pattern: 'calls/[id]/clips', mod: m5 }, // lib/routes/calls/calls/[id]/clips
  { pattern: 'calls/[id]/clips/[clipId]', mod: m6 }, // lib/routes/calls/calls/[id]/clips/[clipId]
  { pattern: 'calls/[id]/comments', mod: m7 }, // lib/routes/calls/calls/[id]/comments
  { pattern: 'calls/[id]/comments/[commentId]', mod: m8 }, // lib/routes/calls/calls/[id]/comments/[commentId]
  { pattern: 'calls/[id]/complete', mod: m9 }, // lib/routes/calls/calls/[id]/complete
  { pattern: 'calls/[id]/export', mod: m10 }, // lib/routes/calls/calls/[id]/export
  { pattern: 'calls/[id]/media', mod: m11 }, // lib/routes/calls/calls/[id]/media
  { pattern: 'calls/[id]/parts/[n]', mod: m12 }, // lib/routes/calls/calls/[id]/parts/[n]
  { pattern: 'calls/[id]/reanalyze', mod: m13 }, // lib/routes/calls/calls/[id]/reanalyze
  { pattern: 'calls/[id]/share', mod: m14 }, // lib/routes/calls/calls/[id]/share
  { pattern: 'calls/[id]/stop', mod: m15 }, // lib/routes/calls/calls/[id]/stop
  { pattern: 'public/[token]', mod: m16 }, // lib/routes/calls/public/[token]
  { pattern: 'public/[token]/media', mod: m17 }, // lib/routes/calls/public/[token]/media
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
