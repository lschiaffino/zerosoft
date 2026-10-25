import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { browseChannels, createChannel, listMyChannels, TalkError } from '@/lib/talk';
import { channelV1, v1Actor } from '@/lib/talk-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/talk/channels?scope=member|all&q= : canales que ve la persona de la key (sin DMs con scope=all). */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'talk:read');
  if ('res' in auth) return auth.res;
  const actor = v1Actor(auth);
  const p = new URL(req.url).searchParams;
  const rows = p.get('scope') === 'all' ? await browseChannels(actor, { q: p.get('q') ?? '' }) : await listMyChannels(actor);
  // Solo canales: los DMs no salen por la API.
  return NextResponse.json({ data: rows.filter((c) => c.kind === 'public' || c.kind === 'private').map(channelV1) });
}

const createSchema = z.object({ name: z.string().min(1).max(100), kind: z.enum(['public', 'private']).default('public'), topic: z.string().max(250).optional(), description: z.string().max(1000).optional() });

/** POST /api/v1/talk/channels { name, kind?, topic?, description? } */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'talk:write');
  if ('res' in auth) return auth.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Expected { name, kind? }.');
  try {
    return NextResponse.json({ data: channelV1(await createChannel(v1Actor(auth), parsed.data)) }, { status: 201 });
  } catch (err) {
    if (err instanceof TalkError) return apiError(err.status, err.code, err.code);
    throw err;
  }
}
