// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/hiring/applications/[id]/route';
import * as m1 from '@/lib/routes/hiring/applications/[id]/emails/route';
import * as m2 from '@/lib/routes/hiring/applications/[id]/evaluators/route';
import * as m3 from '@/lib/routes/hiring/applications/[id]/interviews/route';
import * as m4 from '@/lib/routes/hiring/applications/[id]/notes/route';
import * as m5 from '@/lib/routes/hiring/applications/[id]/offers/route';
import * as m6 from '@/lib/routes/hiring/applications/[id]/scorecards/route';
import * as m7 from '@/lib/routes/hiring/candidates/[id]/route';
import * as m8 from '@/lib/routes/hiring/candidates/[id]/ai/route';
import * as m9 from '@/lib/routes/hiring/candidates/[id]/resume/route';
import * as m10 from '@/lib/routes/hiring/jobs/[id]/route';
import * as m11 from '@/lib/routes/hiring/jobs/[id]/share-link/route';
import * as m12 from '@/lib/routes/hiring/jobs/[id]/stages/route';
import * as m13 from '@/lib/routes/hiring/jobs/[id]/team/route';
import * as m14 from '@/lib/routes/hiring/offers/[id]/route';
import * as m15 from '@/lib/routes/hiring/public/[handle]/sitemap/route';
import * as m16 from '@/lib/routes/hiring/templates/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'applications/[id]', mod: m0 }, // lib/routes/hiring/applications/[id]
  { pattern: 'applications/[id]/emails', mod: m1 }, // lib/routes/hiring/applications/[id]/emails
  { pattern: 'applications/[id]/evaluators', mod: m2 }, // lib/routes/hiring/applications/[id]/evaluators
  { pattern: 'applications/[id]/interviews', mod: m3 }, // lib/routes/hiring/applications/[id]/interviews
  { pattern: 'applications/[id]/notes', mod: m4 }, // lib/routes/hiring/applications/[id]/notes
  { pattern: 'applications/[id]/offers', mod: m5 }, // lib/routes/hiring/applications/[id]/offers
  { pattern: 'applications/[id]/scorecards', mod: m6 }, // lib/routes/hiring/applications/[id]/scorecards
  { pattern: 'candidates/[id]', mod: m7 }, // lib/routes/hiring/candidates/[id]
  { pattern: 'candidates/[id]/ai', mod: m8 }, // lib/routes/hiring/candidates/[id]/ai
  { pattern: 'candidates/[id]/resume', mod: m9 }, // lib/routes/hiring/candidates/[id]/resume
  { pattern: 'jobs/[id]', mod: m10 }, // lib/routes/hiring/jobs/[id]
  { pattern: 'jobs/[id]/share-link', mod: m11 }, // lib/routes/hiring/jobs/[id]/share-link
  { pattern: 'jobs/[id]/stages', mod: m12 }, // lib/routes/hiring/jobs/[id]/stages
  { pattern: 'jobs/[id]/team', mod: m13 }, // lib/routes/hiring/jobs/[id]/team
  { pattern: 'offers/[id]', mod: m14 }, // lib/routes/hiring/offers/[id]
  { pattern: 'public/[handle]/sitemap', mod: m15 }, // lib/routes/hiring/public/[handle]/sitemap
  { pattern: 'templates/[id]', mod: m16 }, // lib/routes/hiring/templates/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
