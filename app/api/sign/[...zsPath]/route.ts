// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/sign/envelopes/[id]/route';
import * as m1 from '@/lib/routes/sign/envelopes/[id]/actions/route';
import * as m2 from '@/lib/routes/sign/envelopes/[id]/document/route';
import * as m3 from '@/lib/routes/sign/envelopes/[id]/fields/route';
import * as m4 from '@/lib/routes/sign/envelopes/[id]/recipients/route';
import * as m5 from '@/lib/routes/sign/public/[token]/route';
import * as m6 from '@/lib/routes/sign/public/[token]/document/route';
import * as m7 from '@/lib/routes/sign/public/[token]/otp/route';
import * as m8 from '@/lib/routes/sign/public/[token]/submit/route';
import * as m9 from '@/lib/routes/sign/templates/[id]/route';
import * as m10 from '@/lib/routes/sign/templates/[id]/document/route';
import * as m11 from '@/lib/routes/sign/templates/[id]/use/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'envelopes/[id]', mod: m0 }, // lib/routes/sign/envelopes/[id]
  { pattern: 'envelopes/[id]/actions', mod: m1 }, // lib/routes/sign/envelopes/[id]/actions
  { pattern: 'envelopes/[id]/document', mod: m2 }, // lib/routes/sign/envelopes/[id]/document
  { pattern: 'envelopes/[id]/fields', mod: m3 }, // lib/routes/sign/envelopes/[id]/fields
  { pattern: 'envelopes/[id]/recipients', mod: m4 }, // lib/routes/sign/envelopes/[id]/recipients
  { pattern: 'public/[token]', mod: m5 }, // lib/routes/sign/public/[token]
  { pattern: 'public/[token]/document', mod: m6 }, // lib/routes/sign/public/[token]/document
  { pattern: 'public/[token]/otp', mod: m7 }, // lib/routes/sign/public/[token]/otp
  { pattern: 'public/[token]/submit', mod: m8 }, // lib/routes/sign/public/[token]/submit
  { pattern: 'templates/[id]', mod: m9 }, // lib/routes/sign/templates/[id]
  { pattern: 'templates/[id]/document', mod: m10 }, // lib/routes/sign/templates/[id]/document
  { pattern: 'templates/[id]/use', mod: m11 }, // lib/routes/sign/templates/[id]/use
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
