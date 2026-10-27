import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { AiError } from '@/lib/ai';
import { getDb, type FlowRunRow, type FlowStepRow } from '@/lib/db';
import { canSeeRunData, parseJson } from '@/lib/flow';
import { troubleshootRun } from '@/lib/flow-ai';
import type { FlowGraph } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, notFound, runViewer, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "Explicar con IA" una corrida fallida: qué pasó, la causa probable y qué
 * cambiar. Usa el error, el paso que falló y su config (sin valores que
 * parezcan secretos); la entrada y salida del paso van solo si quien pide
 * puede ver los datos de la corrida.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = z.object({ locale: z.enum(['en', 'es', 'pt']).default('en') }).safeParse(await req.json().catch(() => ({})));
  const locale = parsed.success ? parsed.data.locale : 'en';
  const db = getDb();
  const run = (await db.prepare('SELECT * FROM flow_runs WHERE id = ? AND user_id = ?').get(id, user.id)) as FlowRunRow | undefined;
  if (!run) return notFound();
  if (run.status !== 'failed') return flowError(400, 'run_not_failed');
  const flow = (await db.prepare('SELECT name, graph FROM flow_flows WHERE id = ? AND user_id = ?').get(run.flow_id, user.id)) as
    | { name: string; graph: string }
    | undefined;
  if (!flow) return notFound();
  const step = (await db
    .prepare("SELECT * FROM flow_steps WHERE run_id = ? AND status = 'failed' ORDER BY started_at DESC, rowid DESC LIMIT 1")
    .get(id)) as FlowStepRow | undefined;
  const graph =
    parseJson<{ graph?: FlowGraph }>(run.context, {}).graph ?? parseJson<FlowGraph>(flow.graph, { nodes: [], edges: [] });
  const node = step ? graph.nodes.find((n) => n.id === step.node_id) : undefined;
  const error = step?.error ?? run.error ?? 'error';
  const t = await getTranslations({ locale, namespace: 'flow' });
  const code = error.replace(/^http_\d+$/, 'http');
  const errorText = t.has(`stepErrors.${code}`) ? t(`stepErrors.${code}`, { status: error.replace(/\D/g, '') }) : '';
  try {
    const result = await troubleshootRun(
      user.id,
      {
        flowName: flow.name,
        error,
        triggerType: run.trigger_type,
        failedNode: node ? { id: node.id, type: node.type, config: node.config } : null,
        stepData: step && canSeeRunData(runViewer(user), run) ? { input: parseJson(step.input, null), output: parseJson(step.output, null) } : null,
        errorText,
      },
      locale,
    );
    return NextResponse.json({ explanation: result });
  } catch (err) {
    if (err instanceof AiError) return flowError(err.code === 'ai_disabled' ? 503 : 429, err.code);
    return flowError(502, 'ai_error');
  }
}
