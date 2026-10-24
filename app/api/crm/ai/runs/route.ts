import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { invalidBody, limitAction, unauthorized } from '@/lib/crm-http';
import { getDb } from '@/lib/db';
import { createRun, defaultRunName, listRuns, runCreateSchema, stepRun } from '@/lib/crm-ai-agents';
import { crmAiAvailable } from '@/lib/crm-ai';
import { aiErrorResponse, aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listRuns(user.id) });
}

/** Crea una corrida de un agente (datos o prospección) y empieza a procesarla. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = runCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  // El agente de contactos no usa IA; los otros dos sí.
  if (parsed.data.agent !== 'enrich_contacts' && !(await crmAiAvailable())) {
    return NextResponse.json({ error: 'ai_disabled' }, { status: 503 });
  }
  const limited = await limitAction(realUserId(user), 'ai-runs', 30, 3600);
  if (limited) return limited;
  const locale = aiLocale(req, parsed.data.locale);
  let listName: string | null = null;
  if (parsed.data.listId) {
    const row = (await getDb().prepare('SELECT name FROM crm_lists WHERE id = ? AND user_id = ?').get(parsed.data.listId, user.id)) as
      | { name: string }
      | undefined;
    listName = row?.name ?? null;
  }
  try {
    const run = await createRun({
      workspaceId: user.id,
      personId: realUserId(user),
      scope: await sessionScope(user),
      input: { ...parsed.data, locale },
      defaultName: defaultRunName(parsed.data.agent, locale, listName),
    });
    // Primera tanda en segundo plano; el resto lo avanzan la página y el cron.
    after(() => stepRun(user.id, run.id, 20_000).catch(() => {}));
    return NextResponse.json(run, { status: 201 });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
