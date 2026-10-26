import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, extractBearer } from '@/lib/api-auth';
import { rateLimit } from '@/lib/rate-limit';
import { appByToken, sessionForApp, TrackAgentError } from '@/lib/track-agents';

async function auth(req: Request, sessionId: string) {
  const token = extractBearer(req);
  const app = token ? await appByToken(token) : null;
  if (!app) return { res: apiError(401, 'unauthorized', 'Use the agent token (Bearer zsa_...).') } as const;
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const rl = await rateLimit(`track-agent:${app.id}`, 120, 60);
    if (!rl.ok) return { res: apiError(429, 'rate_limited', 'Too many requests.') } as const;
  }
  const session = await sessionForApp(app, sessionId);
  if (!session) return { res: apiError(404, 'not_found', 'Session not found.') } as const;
  return { app, session } as const;
}

function agentError(err: unknown) {
  if (err instanceof TrackAgentError) return apiError(err.status, err.code, err.code);
  throw err;
}
import { addAgentActivity, agentActivityInputSchema } from '@/lib/track-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { type: thought|action|elicitation|response|error, body, action?, parameter?, result?, ephemeral? } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const a = await auth(req, (await props.params).id);
  if ('res' in a) return a.res;
  const parsed = agentActivityInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  try {
    return NextResponse.json({ data: await addAgentActivity(a.session, parsed.data) }, { status: 201 });
  } catch (err) {
    return agentError(err);
  }
}
