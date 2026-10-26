// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/talk/channels/[id]/route';
import * as m1 from '@/lib/routes/talk/channels/[id]/hooks/route';
import * as m2 from '@/lib/routes/talk/channels/[id]/members/route';
import * as m3 from '@/lib/routes/talk/channels/[id]/messages/route';
import * as m4 from '@/lib/routes/talk/channels/[id]/pins/route';
import * as m5 from '@/lib/routes/talk/channels/[id]/read/route';
import * as m6 from '@/lib/routes/talk/channels/[id]/typing/route';
import * as m7 from '@/lib/routes/talk/files/[id]/route';
import * as m8 from '@/lib/routes/talk/hooks/[token]/route';
import * as m9 from '@/lib/routes/talk/messages/[id]/route';
import * as m10 from '@/lib/routes/talk/messages/[id]/issue/route';
import * as m11 from '@/lib/routes/talk/messages/[id]/pin/route';
import * as m12 from '@/lib/routes/talk/messages/[id]/reactions/route';
import * as m13 from '@/lib/routes/talk/messages/[id]/save/route';
import * as m14 from '@/lib/routes/talk/scheduled/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'channels/[id]', mod: m0 }, // lib/routes/talk/channels/[id]
  { pattern: 'channels/[id]/hooks', mod: m1 }, // lib/routes/talk/channels/[id]/hooks
  { pattern: 'channels/[id]/members', mod: m2 }, // lib/routes/talk/channels/[id]/members
  { pattern: 'channels/[id]/messages', mod: m3 }, // lib/routes/talk/channels/[id]/messages
  { pattern: 'channels/[id]/pins', mod: m4 }, // lib/routes/talk/channels/[id]/pins
  { pattern: 'channels/[id]/read', mod: m5 }, // lib/routes/talk/channels/[id]/read
  { pattern: 'channels/[id]/typing', mod: m6 }, // lib/routes/talk/channels/[id]/typing
  { pattern: 'files/[id]', mod: m7 }, // lib/routes/talk/files/[id]
  { pattern: 'hooks/[token]', mod: m8 }, // lib/routes/talk/hooks/[token]
  { pattern: 'messages/[id]', mod: m9 }, // lib/routes/talk/messages/[id]
  { pattern: 'messages/[id]/issue', mod: m10 }, // lib/routes/talk/messages/[id]/issue
  { pattern: 'messages/[id]/pin', mod: m11 }, // lib/routes/talk/messages/[id]/pin
  { pattern: 'messages/[id]/reactions', mod: m12 }, // lib/routes/talk/messages/[id]/reactions
  { pattern: 'messages/[id]/save', mod: m13 }, // lib/routes/talk/messages/[id]/save
  { pattern: 'scheduled/[id]', mod: m14 }, // lib/routes/talk/scheduled/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
