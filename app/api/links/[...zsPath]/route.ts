// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/links/[id]/route';
import * as m1 from '@/lib/routes/links/[id]/analytics/route';
import * as m2 from '@/lib/routes/links/[id]/clicks/route';
import * as m3 from '@/lib/routes/links/[id]/comments/route';
import * as m4 from '@/lib/routes/links/[id]/comments/[commentId]/route';
import * as m5 from '@/lib/routes/links/[id]/duplicate/route';
import * as m6 from '@/lib/routes/links/[id]/export.csv/route';
import * as m7 from '@/lib/routes/links/[id]/qr/route';
import * as m8 from '@/lib/routes/links/domains/[id]/route';
import * as m9 from '@/lib/routes/links/domains/[id]/verify/route';
import * as m10 from '@/lib/routes/links/folders/[id]/route';
import * as m11 from '@/lib/routes/links/qr-templates/[id]/route';
import * as m12 from '@/lib/routes/links/shares/[id]/route';
import * as m13 from '@/lib/routes/links/utm-templates/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: '[id]', mod: m0 }, // lib/routes/links/[id]
  { pattern: '[id]/analytics', mod: m1 }, // lib/routes/links/[id]/analytics
  { pattern: '[id]/clicks', mod: m2 }, // lib/routes/links/[id]/clicks
  { pattern: '[id]/comments', mod: m3 }, // lib/routes/links/[id]/comments
  { pattern: '[id]/comments/[commentId]', mod: m4 }, // lib/routes/links/[id]/comments/[commentId]
  { pattern: '[id]/duplicate', mod: m5 }, // lib/routes/links/[id]/duplicate
  { pattern: '[id]/export.csv', mod: m6 }, // lib/routes/links/[id]/export.csv
  { pattern: '[id]/qr', mod: m7 }, // lib/routes/links/[id]/qr
  { pattern: 'domains/[id]', mod: m8 }, // lib/routes/links/domains/[id]
  { pattern: 'domains/[id]/verify', mod: m9 }, // lib/routes/links/domains/[id]/verify
  { pattern: 'folders/[id]', mod: m10 }, // lib/routes/links/folders/[id]
  { pattern: 'qr-templates/[id]', mod: m11 }, // lib/routes/links/qr-templates/[id]
  { pattern: 'shares/[id]', mod: m12 }, // lib/routes/links/shares/[id]
  { pattern: 'utm-templates/[id]', mod: m13 }, // lib/routes/links/utm-templates/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
