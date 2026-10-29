import { NextRequest } from 'next/server';
import { z } from 'zod';
import { magicWrite } from '@/lib/design-ai';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum(['write', 'rewrite', 'shorter', 'longer', 'formal', 'casual']),
  text: z.string().max(4000).default(''),
  prompt: z.string().max(1000).default(''),
  locale: z.enum(['en', 'es', 'pt']).default('en'),
});

/** Magic write: escribir desde una indicación o reescribir el texto elegido. Usa la cuota de IA del workspace. */
export async function POST(req: NextRequest) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  if (parsed.data.action === 'write' ? !parsed.data.prompt.trim() : !parsed.data.text.trim()) return designJson({ error: 'invalid_input' }, 400);
  try {
    return designJson({ text: await magicWrite(s.actor.ws, parsed.data) });
  } catch (err) {
    return designFail(err);
  }
}
