import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { listSlots, setSlots } from '@/lib/social';
import { jsonError } from '@/lib/write-limit';
import { isValidTimeZone } from '@/lib/user-tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Horarios de la cola de la cuenta (día de la semana + minuto del día, en su zona). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(async ({ actor }) => NextResponse.json({ slots: await listSlots(actor, id) }));
}

const schema = z.object({
  slots: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), minute: z.number().int().min(0).max(1439), tz: z.string().max(64) }))
    .max(100),
});

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body || body.slots.some((s) => !isValidTimeZone(s.tz))) return jsonError(400, 'invalid_input');
      return NextResponse.json({ slots: await setSlots(actor, id, body.slots) });
    },
    { write: 'slots', limit: 60 },
  );
}
