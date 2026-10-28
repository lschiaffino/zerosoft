import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRobot, getRobotRun } from '@/lib/robots';
import { AiError, suggestSelectorFix } from '@/lib/robots-ai';
import { aiErrorCode, canEditRobots, forbidden, notFound, robotError, unauthorized } from '@/lib/robots-http';
import { requestLocale } from '@/lib/request-locale';
import { stepPath } from '@/lib/robots-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Sugerir un arreglo con IA": selector nuevo para el paso que falló, desde el DOM capturado. Solo admins. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const run = await getRobotRun(user.id, id);
  if (!run) return notFound();
  if (!run.failure) return robotError(400, 'no_failure');
  const robot = await getRobot(user.id, run.robotId);
  if (!robot) return notFound();
  const path = stepPath(run.failure.step);
  const top = path ? robot.steps[path.index] : undefined;
  const step = top && path?.child !== null && path?.child !== undefined ? (top.type === 'loop_over' ? top.steps[path.child] : undefined) : top;
  if (!path || !step) return robotError(404, 'step_not_found');
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  try {
    const fix = await suggestSelectorFix(user.id, step as Record<string, unknown>, run.failure, locale);
    return NextResponse.json({ index: path.index, child: path.child, step: run.failure.step, ...fix });
  } catch (err) {
    if (err instanceof AiError) return robotError(err.code === 'ai_disabled' ? 503 : 429, aiErrorCode(err.code));
    return robotError(502, 'generic');
  }
}
