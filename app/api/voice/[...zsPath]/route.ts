// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/voice/dictionary/[id]/route';
import * as m1 from '@/lib/routes/voice/sessions/[id]/route';
import * as m2 from '@/lib/routes/voice/sessions/[id]/close/route';
import * as m3 from '@/lib/routes/voice/sessions/[id]/heartbeat/route';
import * as m4 from '@/lib/routes/voice/sessions/[id]/link/route';
import * as m5 from '@/lib/routes/voice/sessions/[id]/send/route';
import * as m6 from '@/lib/routes/voice/templates/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'dictionary/[id]', mod: m0 }, // lib/routes/voice/dictionary/[id]
  { pattern: 'sessions/[id]', mod: m1 }, // lib/routes/voice/sessions/[id]
  { pattern: 'sessions/[id]/close', mod: m2 }, // lib/routes/voice/sessions/[id]/close
  { pattern: 'sessions/[id]/heartbeat', mod: m3 }, // lib/routes/voice/sessions/[id]/heartbeat
  { pattern: 'sessions/[id]/link', mod: m4 }, // lib/routes/voice/sessions/[id]/link
  { pattern: 'sessions/[id]/send', mod: m5 }, // lib/routes/voice/sessions/[id]/send
  { pattern: 'templates/[id]', mod: m6 }, // lib/routes/voice/templates/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
