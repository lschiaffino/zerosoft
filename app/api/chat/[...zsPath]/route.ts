// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/chat/canned/[id]/route';
import * as m1 from '@/lib/routes/chat/conversations/[id]/route';
import * as m2 from '@/lib/routes/chat/conversations/[id]/attachments/route';
import * as m3 from '@/lib/routes/chat/conversations/[id]/crm/route';
import * as m4 from '@/lib/routes/chat/conversations/[id]/macro/route';
import * as m5 from '@/lib/routes/chat/conversations/[id]/merge/route';
import * as m6 from '@/lib/routes/chat/conversations/[id]/messages/route';
import * as m7 from '@/lib/routes/chat/conversations/[id]/messages/[messageId]/route';
import * as m8 from '@/lib/routes/chat/conversations/[id]/read/route';
import * as m9 from '@/lib/routes/chat/conversations/[id]/tags/route';
import * as m10 from '@/lib/routes/chat/conversations/[id]/transcript/route';
import * as m11 from '@/lib/routes/chat/conversations/[id]/typing/route';
import * as m12 from '@/lib/routes/chat/rules/[id]/route';
import * as m13 from '@/lib/routes/chat/rules/[id]/reorder/route';
import * as m14 from '@/lib/routes/chat/visitors/[id]/route';
import * as m15 from '@/lib/routes/chat/widgets/[id]/route';
import * as m16 from '@/lib/routes/chat/widgets/[id]/canned/route';
import * as m17 from '@/lib/routes/chat/widgets/[id]/identity/route';
import * as m18 from '@/lib/routes/chat/widgets/[id]/rules/route';
import * as m19 from '@/lib/routes/chat/widgets/[id]/sla/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'canned/[id]', mod: m0 }, // lib/routes/chat/canned/[id]
  { pattern: 'conversations/[id]', mod: m1 }, // lib/routes/chat/conversations/[id]
  { pattern: 'conversations/[id]/attachments', mod: m2 }, // lib/routes/chat/conversations/[id]/attachments
  { pattern: 'conversations/[id]/crm', mod: m3 }, // lib/routes/chat/conversations/[id]/crm
  { pattern: 'conversations/[id]/macro', mod: m4 }, // lib/routes/chat/conversations/[id]/macro
  { pattern: 'conversations/[id]/merge', mod: m5 }, // lib/routes/chat/conversations/[id]/merge
  { pattern: 'conversations/[id]/messages', mod: m6 }, // lib/routes/chat/conversations/[id]/messages
  { pattern: 'conversations/[id]/messages/[messageId]', mod: m7 }, // lib/routes/chat/conversations/[id]/messages/[messageId]
  { pattern: 'conversations/[id]/read', mod: m8 }, // lib/routes/chat/conversations/[id]/read
  { pattern: 'conversations/[id]/tags', mod: m9 }, // lib/routes/chat/conversations/[id]/tags
  { pattern: 'conversations/[id]/transcript', mod: m10 }, // lib/routes/chat/conversations/[id]/transcript
  { pattern: 'conversations/[id]/typing', mod: m11 }, // lib/routes/chat/conversations/[id]/typing
  { pattern: 'rules/[id]', mod: m12 }, // lib/routes/chat/rules/[id]
  { pattern: 'rules/[id]/reorder', mod: m13 }, // lib/routes/chat/rules/[id]/reorder
  { pattern: 'visitors/[id]', mod: m14 }, // lib/routes/chat/visitors/[id]
  { pattern: 'widgets/[id]', mod: m15 }, // lib/routes/chat/widgets/[id]
  { pattern: 'widgets/[id]/canned', mod: m16 }, // lib/routes/chat/widgets/[id]/canned
  { pattern: 'widgets/[id]/identity', mod: m17 }, // lib/routes/chat/widgets/[id]/identity
  { pattern: 'widgets/[id]/rules', mod: m18 }, // lib/routes/chat/widgets/[id]/rules
  { pattern: 'widgets/[id]/sla', mod: m19 }, // lib/routes/chat/widgets/[id]/sla
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
