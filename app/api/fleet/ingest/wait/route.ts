import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, limit } from '@/lib/fleet/api';
import { ownerOfToken, waitForReply } from '@/lib/fleet/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ session: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/), ms: z.number().int().min(0).max(25_000).default(20_000) });

/** POST { session, ms }: el Stop hook en modo "esperar respuesta" espera hasta ms una respuesta tuya. */
export async function POST(req: NextRequest) {
  const owner = await ownerOfToken(req.headers.get('authorization'));
  if (!owner) return fJson({ error: 'unauthorized' }, 401);
  const limited = await limit(`wait:${owner.tokenId}`, 60, 60);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fJson({ error: 'invalid_input' }, 400);
  const output = await waitForReply(owner, parsed.data.session, parsed.data.ms);
  return fJson({ ok: true, output: output ?? {} });
}
