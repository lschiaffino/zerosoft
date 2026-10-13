import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/rate-limit';
import { AI_TOOL_KINDS, runAiTool, type AiToolKind } from '@/lib/tools/ai-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Herramientas gratis con AI (sin login). Body: { kind, input }.
 * El límite por IP lo aplica runAiTool; sin AI responde con fallback o con
 * { status: 'unavailable', reason }.
 */
export async function POST(req: Request) {
  let body: { kind?: unknown; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }
  const kind = body.kind as AiToolKind;
  if (!AI_TOOL_KINDS.includes(kind)) return NextResponse.json({ status: 'invalid' }, { status: 400 });
  const result = await runAiTool(kind, body.input, clientIp(req));
  if (result.status === 'invalid') return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
