// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/agents/[id]/ab/route';
import * as m1 from '@/lib/routes/agents/[id]/access/route';
import * as m2 from '@/lib/routes/agents/[id]/analytics/route';
import * as m3 from '@/lib/routes/agents/[id]/approvals/route';
import * as m4 from '@/lib/routes/agents/[id]/approvals/[aid]/route';
import * as m5 from '@/lib/routes/agents/[id]/blocked/route';
import * as m6 from '@/lib/routes/agents/[id]/channels/route';
import * as m7 from '@/lib/routes/agents/[id]/conversations/route';
import * as m8 from '@/lib/routes/agents/[id]/conversations/[cid]/route';
import * as m9 from '@/lib/routes/agents/[id]/export/route';
import * as m10 from '@/lib/routes/agents/[id]/feedback/route';
import * as m11 from '@/lib/routes/agents/[id]/files/[fid]/route';
import * as m12 from '@/lib/routes/agents/[id]/integrations/route';
import * as m13 from '@/lib/routes/agents/[id]/memories/[mid]/route';
import * as m14 from '@/lib/routes/agents/[id]/meta/route';
import * as m15 from '@/lib/routes/agents/[id]/qa/route';
import * as m16 from '@/lib/routes/agents/[id]/qa/[qid]/route';
import * as m17 from '@/lib/routes/agents/[id]/secrets/route';
import * as m18 from '@/lib/routes/agents/[id]/secrets/[hid]/route';
import * as m19 from '@/lib/routes/agents/[id]/slack/route';
import * as m20 from '@/lib/routes/agents/[id]/sources/route';
import * as m21 from '@/lib/routes/agents/[id]/suggestions/route';
import * as m22 from '@/lib/routes/agents/[id]/tests/route';
import * as m23 from '@/lib/routes/agents/[id]/tests/[tid]/route';
import * as m24 from '@/lib/routes/agents/[id]/versions/route';
import * as m25 from '@/lib/routes/agents/[id]/versions/[vid]/route';
import * as m26 from '@/lib/routes/agents/[id]/widgets/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'ab', mod: m0 }, // lib/routes/agents/[id]/ab
  { pattern: 'access', mod: m1 }, // lib/routes/agents/[id]/access
  { pattern: 'analytics', mod: m2 }, // lib/routes/agents/[id]/analytics
  { pattern: 'approvals', mod: m3 }, // lib/routes/agents/[id]/approvals
  { pattern: 'approvals/[aid]', mod: m4 }, // lib/routes/agents/[id]/approvals/[aid]
  { pattern: 'blocked', mod: m5 }, // lib/routes/agents/[id]/blocked
  { pattern: 'channels', mod: m6 }, // lib/routes/agents/[id]/channels
  { pattern: 'conversations', mod: m7 }, // lib/routes/agents/[id]/conversations
  { pattern: 'conversations/[cid]', mod: m8 }, // lib/routes/agents/[id]/conversations/[cid]
  { pattern: 'export', mod: m9 }, // lib/routes/agents/[id]/export
  { pattern: 'feedback', mod: m10 }, // lib/routes/agents/[id]/feedback
  { pattern: 'files/[fid]', mod: m11 }, // lib/routes/agents/[id]/files/[fid]
  { pattern: 'integrations', mod: m12 }, // lib/routes/agents/[id]/integrations
  { pattern: 'memories/[mid]', mod: m13 }, // lib/routes/agents/[id]/memories/[mid]
  { pattern: 'meta', mod: m14 }, // lib/routes/agents/[id]/meta
  { pattern: 'qa', mod: m15 }, // lib/routes/agents/[id]/qa
  { pattern: 'qa/[qid]', mod: m16 }, // lib/routes/agents/[id]/qa/[qid]
  { pattern: 'secrets', mod: m17 }, // lib/routes/agents/[id]/secrets
  { pattern: 'secrets/[hid]', mod: m18 }, // lib/routes/agents/[id]/secrets/[hid]
  { pattern: 'slack', mod: m19 }, // lib/routes/agents/[id]/slack
  { pattern: 'sources', mod: m20 }, // lib/routes/agents/[id]/sources
  { pattern: 'suggestions', mod: m21 }, // lib/routes/agents/[id]/suggestions
  { pattern: 'tests', mod: m22 }, // lib/routes/agents/[id]/tests
  { pattern: 'tests/[tid]', mod: m23 }, // lib/routes/agents/[id]/tests/[tid]
  { pattern: 'versions', mod: m24 }, // lib/routes/agents/[id]/versions
  { pattern: 'versions/[vid]', mod: m25 }, // lib/routes/agents/[id]/versions/[vid]
  { pattern: 'widgets', mod: m26 }, // lib/routes/agents/[id]/widgets
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
